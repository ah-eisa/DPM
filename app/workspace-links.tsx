const links = [
  ["Dashboard", "/"],
  ["Operations", "/operations"],
  ["Book controls", "/controls"],
  ["Performance", "/performance"],
  ["Backup", "/backup"],
  ["Market access", "/access"],
] as const;

export function WorkspaceLinks({ current }: { current: string }) {
  return <nav aria-label="Workspace" className="row workspace-links">{links.filter(([,href]) => href !== current).map(([label,href]) => <a key={href} href={href} className="btn">{label}</a>)}</nav>;
}
