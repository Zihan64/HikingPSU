import { TIER_EMOJI, TIER_LABEL } from './checkin'

// The tier emoji, announced as e.g. "Gold badge".
export function BadgeEmoji({ badge, className }) {
  return <span role="img" aria-label={`${TIER_LABEL[badge.tier] || badge.tier} badge`} className={className}>{TIER_EMOJI[badge.tier] || '🏅'}</span>
}

// Earned badges as cards (tier emoji, title, description, date), newest first as the server sends them.
export default function BadgeGrid({ badges, className = '', label }) {
  return (
    <ul className={`grid gap-2 sm:grid-cols-2 xl:grid-cols-3 ${className}`.trim()} aria-label={label}>
      {badges.map(b => (
        <li key={b.key} className="flex items-start gap-3 rounded-xl border border-[#e0e5dc] bg-[#fafbf8] p-3">
          <BadgeEmoji badge={b} className="text-2xl leading-none" />
          <div className="min-w-0 text-sm">
            <div className="font-semibold">{b.title}</div>
            <div className="text-xs text-[#5b6a58]">{b.description}</div>
            <div className="mt-1 text-[11px] text-[#73806e]">{new Date(b.awarded_at).toLocaleDateString()}</div>
          </div>
        </li>
      ))}
    </ul>
  )
}
