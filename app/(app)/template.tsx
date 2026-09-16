// Remounts on every navigation, giving each screen a 200ms settle-in
// (globals.css .animate-page-in). A template, not a layout, on purpose:
// layouts persist across routes and would only animate once.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-page-in">{children}</div>;
}
