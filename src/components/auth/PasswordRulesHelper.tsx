type PasswordRuleStatus = {
  label: string;
  passed: boolean;
};

export function PasswordRulesHelper({ id, rules }: { id: string; rules: PasswordRuleStatus[] }) {
  return (
    <div
      id={id}
      aria-live="polite"
      className="rounded-xl bg-gray-50 px-4 py-3 text-xs text-gray-700"
    >
      <p className="mb-2 font-semibold text-gray-800">Password must include:</p>
      <ul className="space-y-1">
        {rules.map((rule) => (
          <li key={rule.label} className="flex items-center gap-2">
            <span aria-hidden="true">{rule.passed ? '[ok]' : '[ ]'}</span>
            <span className={rule.passed ? 'text-green-700' : 'text-gray-700'}>{rule.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
