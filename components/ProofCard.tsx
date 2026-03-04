interface ProofCardProps {
  number: string | number;
  label: string;
}

export default function ProofCard({ number, label }: ProofCardProps) {
  return (
    <div className="text-center">
      <div className="text-3xl font-extrabold text-charcoal">{number}</div>
      <div className="text-sm text-gray-400 mt-1">{label}</div>
    </div>
  );
}
