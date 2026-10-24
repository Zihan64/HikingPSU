const LEVEL_COLORS = {
  1: 'bg-emerald-100 text-emerald-800',
  2: 'bg-lime-100 text-lime-800',
  3: 'bg-amber-100 text-amber-800',
  4: 'bg-orange-100 text-orange-800',
  5: 'bg-red-100 text-red-800',
}

export default function TrailCard({ t, selected = false, onSelect }) {
  const d = t.difficulty
  const access = t.access.bus || (t.access.walk_from_campus_min != null ? `${t.access.walk_from_campus_min} min walk` : `${t.access.drive_min} min drive`)
  return (
    <div
      onClick={onSelect}
      className={`rounded-xl border bg-white p-4 shadow-sm ${onSelect ? 'cursor-pointer hover:border-stone-400' : ''} ${selected ? 'border-stone-800 ring-1 ring-stone-800' : 'border-stone-200'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{t.name}</h3>
          <p className="text-sm text-stone-500">{t.area}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${LEVEL_COLORS[d.level]}`}>
          L{d.level} · {d.label}
        </span>
      </div>
      <p className="mt-2 text-sm text-stone-700">
        {t.distance_mi} mi · {t.elevation_gain_ft} ft gain · ~{Math.round(d.est_time_min / 60 * 10) / 10} h
      </p>
      <ul className="mt-2 list-disc pl-5 text-sm text-stone-600">
        {d.reasons.map((r, i) => <li key={i}>{r}</li>)}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className={`rounded px-2 py-0.5 ${t.car_free ? 'bg-sky-100 text-sky-800' : 'bg-stone-100 text-stone-600'}`}>
          {t.car_free ? '🚌 ' : '🚗 '}{access}
        </span>
        {t.hunting_zone && <span className="rounded bg-orange-100 px-2 py-0.5 text-orange-800">🟠 hunting zone</span>}
        {t.cell_signal !== 'good' && <span className="rounded bg-stone-100 px-2 py-0.5 text-stone-600">📶 {t.cell_signal}</span>}
      </div>
    </div>
  )
}
