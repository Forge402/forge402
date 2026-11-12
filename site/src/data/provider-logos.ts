// Provider marks live in public/logos/ai/<slug>.svg (official @lobehub/icons-static-svg marks, monograms where none exist).
// Single-colour marks are ink; they also ship a <slug>-white.svg twin for dark backgrounds.
const MONO = new Set(['baai', 'ibm', 'moonshot', 'openai', 'z-ai'])

export const providerSlug = (provider: string): string =>
  provider.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

export const providerLogo = (provider: string): string => `/logos/ai/${providerSlug(provider)}.svg`

/** Same mark for a dark background: the white twin for single-colour marks, otherwise the normal file. */
export const providerLogoOnDark = (provider: string): string => {
  const slug = providerSlug(provider)
  return MONO.has(slug) ? `/logos/ai/${slug}-white.svg` : `/logos/ai/${slug}.svg`
}
