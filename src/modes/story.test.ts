import { describe, expect, it } from 'vitest'
import { buildStoryPackageBridge, buildStoryScenes, splitStoryScript } from './story.js'

const script =
  '퇴근하고 집에 왔는데 현관 앞에 처음 보는 택배가 놓여 있었다. 이름은 내 이름이 맞았지만 주문한 적은 없었다. 상자를 열자 오래된 카메라와 짧은 메모가 나왔다. 메모에는 오늘 밤 11시에 창밖을 보라고 적혀 있었다.'

describe('maxSceneChars 옵트인 장면 분할', () => {
  it('기본값(180)은 기존 동작을 유지한다(짧은 대본 = 한 장면)', () => {
    const scenes = buildStoryScenes({
      projectName: 'p',
      title: 't',
      script: '첫 문장입니다. 둘째 문장입니다. 셋째 문장입니다.',
    })
    expect(scenes).toHaveLength(1)
  })

  it('maxSceneChars를 줄이면 장면이 잘게 나뉜다', () => {
    const scenes = buildStoryScenes({
      projectName: 'p',
      title: 't',
      script: '첫 문장입니다. 둘째 문장입니다. 셋째 문장입니다.',
      maxSceneChars: 12,
    })
    expect(scenes.length).toBeGreaterThanOrEqual(3)
  })
})

describe('story mode', () => {
  it('splits a script into scene-sized chunks', () => {
    const scenes = splitStoryScript(script, 70)
    expect(scenes.length).toBeGreaterThan(1)
    expect(scenes[0]).toContain('택배')
  })

  it('builds narration, caption, and image prompts for every scene', () => {
    const scenes = buildStoryScenes({
      projectName: 'mystery-story',
      title: '수상한 택배',
      script,
      tone: 'tense',
      imageStyle: 'cinematic realistic still',
    })
    expect(scenes[0]?.narration).toContain('퇴근')
    expect(scenes[0]?.caption.length).toBeLessThanOrEqual(72)
    expect(scenes[0]?.imagePrompt).toContain('vertical 9:16')
  })

  it('모든 장면의 이미지 프롬프트에 전체 스토리 맥락과 일관성 지시를 포함한다', () => {
    const scenes = buildStoryScenes({
      projectName: 'mystery-story',
      title: '수상한 택배',
      script,
      maxSceneChars: 60,
    })
    expect(scenes.length).toBeGreaterThan(1)
    for (const scene of scenes) {
      // 장면 단독이 아니라 전체 이야기를 알고 그리게 한다 (마지막 장면 내용이 첫 장면 프롬프트에도 있어야 함)
      expect(scene.imagePrompt).toContain('full story')
      expect(scene.imagePrompt).toContain('창밖')
      // 캐릭터/스타일 일관성 지시
      expect(scene.imagePrompt).toContain('consistent')
      // 현재 장면 표시 (전체 중 몇 번째인지)
      expect(scene.imagePrompt).toContain(`scene ${scene.index} of ${scenes.length}`)
    }
  })

  it('한국인 인물 지시와 직전 장면 이어받기를 포함한다', () => {
    const scenes = buildStoryScenes({
      projectName: 'mystery-story',
      title: '수상한 택배',
      script,
      maxSceneChars: 60,
    })
    expect(scenes.length).toBeGreaterThan(1)
    for (const scene of scenes) {
      expect(scene.imagePrompt).toContain('Korean')
    }
    // 첫 장면은 이전 장면이 없다
    expect(scenes[0]?.imagePrompt).not.toContain('previous scene')
    // 두 번째 장면부터는 직전 장면 내용을 이어받는다
    expect(scenes[1]?.imagePrompt).toContain('previous scene')
    expect(scenes[1]?.imagePrompt).toContain(scenes[0]?.narration ?? '')
  })

  it('주인공 설정을 주면 모든 장면 프롬프트에 인물 고정 지시가 들어간다', () => {
    const scenes = buildStoryScenes({
      projectName: 'mystery-story',
      title: '수상한 택배',
      script,
      maxSceneChars: 60,
      character: '30대 한국인 남성, 짧은 검은 머리, 어두운 재킷',
    })
    for (const scene of scenes) {
      expect(scene.imagePrompt).toContain('30대 한국인 남성, 짧은 검은 머리, 어두운 재킷')
      expect(scene.imagePrompt).toContain('main character')
      // 조연 인물(장면에 언급된 사람)도 그리라는 지시
      expect(scene.imagePrompt).toContain('every person mentioned')
    }
  })

  it('숏 연출을 주면 각 장면 프롬프트에 촬영 지시로 들어간다', () => {
    const shots = ['떨리는 손 클로즈업, 낮은 조명', '복도 끝을 향한 로우앵글, 역광']
    const scenes = buildStoryScenes(
      {
        projectName: 'mystery-story',
        title: '수상한 택배',
        script: '첫 문장입니다. 둘째 문장입니다.',
        maxSceneChars: 10,
      },
      shots,
    )
    expect(scenes.length).toBe(2)
    expect(scenes[0]?.imagePrompt).toContain('떨리는 손 클로즈업')
    expect(scenes[1]?.imagePrompt).toContain('로우앵글')
    expect(scenes[0]?.imagePrompt).toContain('cinematic shot direction')
  })

  it('숏 연출이 없어도 드라마 스틸컷 지시는 기본으로 들어간다', () => {
    const scenes = buildStoryScenes({
      projectName: 'mystery-story',
      title: '수상한 택배',
      script,
      maxSceneChars: 60,
    })
    for (const scene of scenes) {
      expect(scene.imagePrompt).toContain('film still')
    }
  })

  it('세트(장소) 시트를 주면 모든 장면 프롬프트에 고정 세트 지시가 들어간다', () => {
    const world = '1990년대 복도식 아파트, 청록색 철문 1103호, 좁은 형광등 복도, 낡은 은색 엘리베이터'
    const scenes = buildStoryScenes(
      {
        projectName: 'mystery-story',
        title: '수상한 택배',
        script,
        maxSceneChars: 60,
      },
      undefined,
      world,
    )
    for (const scene of scenes) {
      expect(scene.imagePrompt).toContain('1103호')
      expect(scene.imagePrompt).toContain('fixed set design')
    }
    // 세트 없이도 장소 일관성 기본 규칙은 들어간다
    const plain = buildStoryScenes({ projectName: 'p', title: 't', script, maxSceneChars: 60 })
    expect(plain[0]?.imagePrompt).toContain('never redesign')
  })

  it('롱폼(16:9)을 고르면 가로 구도 지시가 들어간다', () => {
    const wide = buildStoryScenes({ projectName: 'p', title: 't', script, maxSceneChars: 60, ratio: '16:9' })
    expect(wide[0]?.imagePrompt).toContain('horizontal 16:9')
    const tall = buildStoryScenes({ projectName: 'p', title: 't', script, maxSceneChars: 60 })
    expect(tall[0]?.imagePrompt).toContain('vertical 9:16')
  })

  it('product 프로파일은 상품 동일성·커머스 룩 지시로 바뀌고 드라마 지시는 빠진다', () => {
    const scenes = buildStoryScenes({
      projectName: 'shop-shorts',
      title: '접이식 선반',
      script: '좁은 주방 때문에 고민이시죠? 이 선반 하나면 순식간에 해결됩니다.',
      maxSceneChars: 20,
      promptProfile: 'product',
    })
    expect(scenes.length).toBeGreaterThan(1)
    for (const scene of scenes) {
      expect(scene.imagePrompt).toContain('never redesign the product')
      expect(scene.imagePrompt).toContain('reference photos')
      expect(scene.imagePrompt).toContain('Korea')
      expect(scene.imagePrompt).not.toContain('Korean drama')
      expect(scene.imagePrompt).not.toContain('main character')
    }
  })

  it('프로파일을 지정하지 않으면 기존 드라마 프로파일 그대로다', () => {
    const scenes = buildStoryScenes({
      projectName: 'p',
      title: 't',
      script,
      maxSceneChars: 60,
    })
    for (const scene of scenes) {
      expect(scene.imagePrompt).toContain('Korean drama')
    }
  })

  it('creates a package bridge that can be consumed by later render steps', () => {
    const bridge = buildStoryPackageBridge({
      projectName: 'mystery-story',
      title: '수상한 택배',
      script,
    })
    expect(bridge.projectName).toBe('mystery-story')
    expect(bridge.sceneCount).toBe(bridge.scenes.length)
  })
})
