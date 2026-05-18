export const metadata = { title: 'Tracker' }

export default function HubTrackerLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 flex flex-col overflow-hidden">{children}</div>
}
