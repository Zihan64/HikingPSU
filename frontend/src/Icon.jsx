export default function Icon({ name, ...props }) {
  const paths = {
    plan: <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z" />,
    trails: <><path d="m3 17 5-10 5 10M11 17l5-13 5 13M2 21h20" /><path d="m6 11 2 2 2-2" /></>,
    map: <><path d="m9 18-6 3V6l6-3 6 3 6-3v15l-6 3-6-3Z" /><path d="M9 3v15M15 6v15" /></>,
    send: <path d="m5 12 7-7 7 7M12 5v15" />,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    back: <path d="M20 12H4m6-6-6 6 6 6" />,
    expand: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />,
    library: <><path d="M3 4h6a4 4 0 0 1 3 1 4 4 0 0 1 3-1h6v16h-6a4 4 0 0 0-3 1 4 4 0 0 0-3-1H3Z" /><path d="M12 5v16" /></>,
    community: <><path d="M17 8h2a2 2 0 0 1 2 2v9l-3-2.5h-6a2 2 0 0 1-2-2V14" /><path d="M3 5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7l-4 3Z" /></>,
    drives: <><path d="M8 21c.5-6 3-9 4-18M16 21c-.5-6-3-9-4-18" /><path d="M12 6v2M12 12v2.5M12 18.5V21" /><path d="M3 21h18" /></>,
    catalog: <><path d="M4 5h16M4 12h16M4 19h16" /><circle cx="8" cy="5" r="2" /><circle cx="16" cy="12" r="2" /><circle cx="10" cy="19" r="2" /></>,
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>
}
