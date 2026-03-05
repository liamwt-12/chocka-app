interface StatsCardProps {
  label: string;
  value: string | number;
  change?: string;
  icon?: string;
}

export default function StatsCard({ label, value, change, icon }: StatsCardProps) {
  const isPositive = change?.startsWith('+');

  return (
    <div className="bg-gray-50 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-gray-500">{label}</span>
        {icon && <span className="text-xl">{icon}</span>}
      </div>
      <div className="text-2xl font-extrabold text-charcoal">{value}</div>
      {change && (
        <div className={`text-sm font-semibold mt-1 ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
          {change} vs last week
        </div>
      )}
    </div>
  );
}
