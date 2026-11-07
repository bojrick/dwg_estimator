import React from 'react';
import { Sparkles } from 'lucide-react';

interface AiBadgeProps {
  label?: string;
  className?: string;
}

/**
 * Standardized notation marking actions that call AI models (DeepInfra Llama 3.1/3.3).
 * Quiet craft design: subtle tint, high-contrast text, clear monospace tag.
 */
export const AiBadge: React.FC<AiBadgeProps> = ({ label = 'AI', className = '' }) => (
  <span
    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold font-mono tracking-wide bg-blue-500/10 text-blue-300 border border-blue-500/25 shrink-0 ${className}`}
  >
    <Sparkles className="w-2.5 h-2.5 text-blue-400" />
    <span>{label}</span>
  </span>
);

