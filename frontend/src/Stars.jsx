export function StarDisplay({ value, className = '' }) {
  const v = value ?? 0
  return (
    <span className={`whitespace-nowrap text-amber-500 ${className}`} role="img" aria-label={value == null ? 'not rated' : `${value} out of 5`}>
      {[1, 2, 3, 4, 5].map(i => <span key={i} className={i <= Math.round(v) ? '' : 'text-stone-300'}>★</span>)}
    </span>
  )
}

export function StarInput({ value, onChange, label }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1">
      {[1, 2, 3, 4, 5].map(i => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={value === i}
          aria-label={`${i} out of 5`}
          onClick={() => onChange(i)}
          className={`text-3xl leading-none ${i <= value ? 'text-amber-500' : 'text-stone-300 hover:text-amber-300'}`}
        >★</button>
      ))}
    </div>
  )
}
