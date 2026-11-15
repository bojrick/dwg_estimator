import React from 'react';

interface AiBadgeProps {
  label?: string;
  className?: string;
}

/**
 * Standardized notation marking actions that call AI models (DeepInfra Llama 3.1/3.3).
 * Quiet craft design: subtle amber tint, high-contrast text, clear monospace tag.
 */
export const AiBadge: React.FC<AiBadgeProps> = ({ label = 'AUTO', className = '' }) => (
  <span
    className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium font-mono bg-amber-400/10 text-amber-300 border border-amber-400/25 shrink-0 ${className}`}
  >
    {label}
  </span>
);

