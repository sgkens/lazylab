import React from 'react';
import markUrl from '../assets/brand/lazylab-mark.svg';

/** The lazylab mark (brand/svg/lazylab-mark.svg). Decorative: the name always sits next to it. */
export const BrandMark: React.FC<{ size?: number; className?: string }> = ({ size = 28, className = '' }) => (
  <img src={markUrl} width={size} height={size} alt="" aria-hidden="true" draggable={false} className={`shrink-0 select-none ${className}`} />
);
