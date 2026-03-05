'use client';

interface SettingsToggleProps {
  label: string;
  description: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  loading?: boolean;
}

export default function SettingsToggle({ label, description, enabled, onChange, loading }: SettingsToggleProps) {
  return (
    <div className="flex items-center justify-between py-4 border-b border-gray-100 last:border-0">
      <div className="flex-1 mr-4">
        <div className="font-semibold text-charcoal text-sm">{label}</div>
        <div className="text-sm text-gray-400 mt-0.5">{description}</div>
      </div>
      <button
        onClick={() => onChange(!enabled)}
        disabled={loading}
        className={`relative w-12 h-7 rounded-full transition-colors duration-200 ${
          enabled ? 'bg-brand' : 'bg-gray-200'
        } ${loading ? 'opacity-50' : ''}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform duration-200 ${
            enabled ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}
