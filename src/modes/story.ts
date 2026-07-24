import { z } from 'zod'

export const storyProjectSchema = z.object({
  projectName: z.string().min(1),
  title: z.string().min(1),
  script: z.string().min(1),
  tone: z.string().min(1).default('dramatic'),
  imageStyle: z.string().min(1).default('realistic vertical social video frame'),
  /** 장면 하나의 최대 글자 수. 작을수록 장면(이미지)이 많아진다. 기본 180(기존 동작 유지). */
  maxSceneChars: z.number().int().min(10).max(400).default(180),
  /** 주인공 고정 묘사(성별·외모). 채널 전체 쇼츠에서 같은 인물이 나오게 할 때 쓴다. */
  character: z.string().optional(),
  /** 화면 비율 — 숏폼 9:16(기본) 또는 롱폼 16:9. 이미지 구도와 렌더 해상도를 결정한다. */
  ratio: z.enum(['9:16', '16:9']).default('9:16'),
  /** 이미지 프롬프트 프로파일 — story(드라마 스틸컷, 기본) | product(쇼핑쇼츠 커머스 광고). */
  promptProfile: z.enum(['story', 'product']).default('story'),
})

export interface StoryScene {
  index: number
  narration: string
  caption: string
  imagePrompt: string
}

export type StoryProject = z.infer<typeof storyProjectSchema>

function clean(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function splitSentences(script: string): string[] {
  return script
    .split(/(?<=[.!?。！？]|다\.|요\.|죠\.)\s+/u)
    .map(clean)
    .filter(Boolean)
}

export function splitStoryScript(script: string, maxChars = 180): string[] {
  const sentences = splitSentences(script)
  const scenes: string[] = []
  let current = ''

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence
    if (current && [...candidate].length > maxChars) {
      scenes.push(current)
      current = sentence
    } else {
      current = candidate
    }
  }

  if (current) scenes.push(current)
  return scenes.length > 0 ? scenes : [clean(script)]
}

/** 쇼핑쇼츠(product) 프로파일 — 상품 참조 사진 동일성 고정 + 커머스 광고 룩. */
function buildProductImagePrompt(
  project: StoryProject,
  chunks: string[],
  scene: string,
  index: number,
  fullStory: string,
  shots?: string[],
): string {
  return [
    project.imageStyle,
    `product advertising scene for: ${project.title}`,
    `full ad script for context: ${fullStory}`,
    `now draw scene ${index + 1} of ${chunks.length}: ${scene}`,
    shots?.[index] ? `cinematic shot direction (follow this composition exactly): ${shots[index]}` : '',
    `tone: ${project.tone}`,
    // 상품 캡처를 참조로 넘길 때 제품이 장면마다 달라지지 않게 못박는다.
    'the product must look exactly identical to the attached product reference photos: same shape, color, logo, materials and proportions — never redesign the product',
    'show the product in a realistic Korean daily-life usage context that matches the narration (hands using it, key feature close-up, before/after moment)',
    'clean bright premium commerce lighting, crisp focus on the product, advertising quality still',
    'any people are Korean (East Asian) with natural appearance, the setting is Korea',
    'avoid repeating the prior shot composition: alternate product close-up, usage shot, detail insert and lifestyle wide shot',
    project.ratio === '16:9'
      ? 'horizontal 16:9 widescreen composition, clear subject, no text in image'
      : 'vertical 9:16 composition, clear subject, no text in image',
  ]
    .filter(Boolean)
    .join(', ')
}

export function buildStoryScenes(projectInput: StoryProject, shots?: string[], world?: string): StoryScene[] {
  const project = storyProjectSchema.parse(projectInput)
  const chunks = splitStoryScript(project.script, project.maxSceneChars)
  // 장면 하나만 주면 이미지마다 인물·배경이 제각각이 된다.
  // 전체 이야기를 함께 넘겨 모든 장면이 같은 세계관/캐릭터로 그려지게 한다.
  const fullStory = clean(project.script).slice(0, 700)
  if (project.promptProfile === 'product') {
    return chunks.map((scene, index) => ({
      index: index + 1,
      narration: scene,
      caption: scene.length > 72 ? `${scene.slice(0, 69).trim()}...` : scene,
      imagePrompt: buildProductImagePrompt(project, chunks, scene, index, fullStory, shots),
    }))
  }
  return chunks.map((scene, index) => ({
    index: index + 1,
    narration: scene,
    caption: scene.length > 72 ? `${scene.slice(0, 69).trim()}...` : scene,
    imagePrompt: [
      project.imageStyle,
      `story title: ${project.title}`,
      `full story for context: ${fullStory}`,
      // 직전 장면을 명시적으로 이어받아 인물 생김새·의상·조명·장소가 그대로 이어지게 한다.
      index > 0
        ? `previous scene (carry over the exact same characters, faces, hairstyles, outfits, lighting and location details from it): ${chunks[index - 1]}`
        : '',
      `now draw scene ${index + 1} of ${chunks.length}: ${scene}`,
      // AI 촬영감독이 설계한 숏 — 문장을 밋밋하게 삽화화하지 않고 그 순간의 후킹 포인트를 연출한다.
      shots?.[index]
        ? `cinematic shot direction (follow this composition exactly): ${shots[index]}`
        : '',
      `tone: ${project.tone}`,
      // 주인공 고정: 성별·외모를 명시해 장면끼리(그리고 채널의 다른 쇼츠끼리) 같은 인물이 나오게 한다.
      project.character
        ? `main character (this exact same person must appear consistently in every scene): ${project.character}`
        : '',
      // 세트 고정: 장소·소품의 시각 디테일을 못박아 아파트/복도/문/엘리베이터가 장면마다 달라지지 않게 한다.
      world
        ? `fixed set design (these locations and props must look visually identical whenever they appear): ${world}`
        : '',
      'all characters are Korean (East Asian) with natural Korean appearance, the setting is Korea',
      'depict every person mentioned or implied in this scene narration (neighbors, strangers, voices behind doors), not only the main character',
      'keep the same consistent main character appearance, outfit, setting and art style across every scene of this story',
      'keep every recurring location, building, door, hallway, elevator and prop visually identical across scenes — never redesign a location between scenes',
      // 드라마 스틸컷 기준 — 밋밋한 설명 삽화 금지, 그 순간의 감정과 긴장이 보이는 한 컷.
      'this must look like a dramatic film still from a Korean drama: expressive camera angle, cinematic lighting, visible emotion on faces, focus on the most gripping moment implied by the narration',
      // 같은 순간의 연속 장면이라도 구도를 반복하지 않게 — 드라마식 숏 분할.
      'avoid repeating the prior shot composition: if this moment continues, change the shot size or angle (wide establishing, close-up, over-the-shoulder, prop insert, reaction shot)',
      // 시네마틱 룩 기본기 — 얕은 심도, 프랙티컬 조명, 시선 일관성.
      'cinematic shallow depth of field with a clearly focused subject, lighting only from practical in-scene sources (fluorescent lamps, door gaps, phone screens)',
      'keep consistent screen direction: characters facing each other stay on the same left/right sides across shots',
      project.ratio === '16:9'
        ? 'horizontal 16:9 widescreen cinematic composition, clear subject, no text in image'
        : 'vertical 9:16 composition, clear subject, no text in image',
    ]
      .filter(Boolean)
      .join(', '),
  }))
}

export function buildStoryPackageBridge(projectInput: StoryProject): {
  projectName: string
  sceneCount: number
  scenes: StoryScene[]
} {
  const project = storyProjectSchema.parse(projectInput)
  const scenes = buildStoryScenes(project)
  return {
    projectName: project.projectName,
    sceneCount: scenes.length,
    scenes,
  }
}
