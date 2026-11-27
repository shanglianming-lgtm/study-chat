import { localSource, type Effort, type Source } from './library'

export function service(url: string) {
  switch (url && new URL(url).hostname) {
    case 'api.openai.com': return 'openai'
    case 'api.anthropic.com': return 'anthropic'
    case 'generativelanguage.googleapis.com': return 'gemini'
    case 'openrouter.ai': return 'openrouter'
    default: return 'compatible'
  }
}

export const levels: Effort[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const standard: Effort[] = ['low', 'medium', 'high']

function documentedLevels(api: ReturnType<typeof service>, id: string): Effort[] {
  if (api === 'openai') {
    if (/^gpt-(6\.2-(astra|sol)|6\.1-(terra|sol)|6-(astra|luna|sol)|5\.6(-(sol|terra|luna))?)(-\d{4}-\d\d-\d\d)?$/.test(id))
      return [...standard, 'xhigh', 'max']
    if (/^gpt-5\.[245](-mini|-nano)?(-\d{4}-\d\d-\d\d)?$/.test(id)) return [...standard, 'xhigh']
    if (/^gpt-5(-mini|-nano)?(-\d{4}-\d\d-\d\d)?$/.test(id)) return ['minimal', ...standard]
    if (/^(o3(-mini)?|o4-mini|gpt-5\.1)(-\d{4}-\d\d-\d\d)?$/.test(id)) return standard
  }
  if (api === 'gemini') {
    if (/^gemini-4-(neon|hydrogen)(-|$)/.test(id)) return [...standard, 'xhigh']
    if (/^gemini-4-(carbon|argon)(-|$)/.test(id)) return standard
    if (/^gemini-(3(\.1)?-flash|3\.1-pro)(-|$)/.test(id))
      return id.includes('flash') ? ['minimal', ...standard] : standard
    if (/^gemini-3-pro(-|$)/.test(id)) return ['low', 'high']
    if (/^gemini-2\.5-(pro|flash)(-lite)?(-preview(-\d\d-\d\d)?|-\d{3})?$/.test(id)) return standard
  }
  if (api === 'anthropic' && /^claude-(opus|sonnet)-4[.-]6(-|$)/.test(id)) return [...standard, 'max']
  if (api === 'anthropic' && /^claude-opus-4[.-]5(-|$)/.test(id)) return standard
  if (api === 'anthropic' && /^claude-((fable|mythos)-5([.-][12])?|mythos-preview|(opus|sonnet)-5([.-]5)?|haiku-5[.-]5|opus-4[.-][78])(-\d{8})?$/.test(id))
    return [...standard, 'xhigh', 'max']
  return []
}

export function effortOptions(source: Source, id: string): Effort[] {
  if (source.id === localSource.id) return ['default', 'minimal', ...standard, 'max']
  const api = service(source.url)
  const saved = source.modelEfforts?.[id]
  let choices: Effort[]
  if (Array.isArray(saved)) choices = levels.filter((level) => saved.includes(level))
  else if (api === 'compatible') choices = ['minimal', ...standard, 'xhigh']
  else if (api === 'openrouter') {
    const [owner, model] = id.split('/')
    const upstream = { openai: 'openai', anthropic: 'anthropic', google: 'gemini' } as const
    choices = owner in upstream && model ? documentedLevels(upstream[owner as keyof typeof upstream], model) : []
  } else choices = documentedLevels(api, id)
  // When the gateway exposes six levels, retain the endpoints and three middle presets.
  if (choices.length > 5) choices = choices.filter((level) => level !== 'xhigh')
  return ['default', ...choices]
}

export function selectedEffort(source: Source, model: string, effort: Effort): Effort {
  if (source.id === localSource.id && effort === 'xhigh') return 'max'
  return effortOptions(source, model).includes(effort) ? effort : 'default'
}
