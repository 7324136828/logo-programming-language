import React from 'react';

const iconPaths: Record<string, string> = {
  turtle: '<path d="m12 3 8 17-8-4-8 4Z"/>',
  play: '<path d="m8 5 11 7-11 7Z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  open: '<path d="M3 8V5h6l2 3h10v12H3Zm0 4h18"/>',
  save: '<path d="M5 3h12l4 4v14H3V3Zm2 0v6h10V3M7 21v-8h10v8"/>',
  export: '<path d="M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6"/>',
  grid: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12h16M12 4v16"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  reset: '<path d="M4 10a8 8 0 1 1 1 7M4 4v6h6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 4 3l-1 1m0 4v.01"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-16-2 20"/>',
  flower: '<path d="M12 12C3 3 21 3 12 12s9 9 0 0-9 9 0 0-9-9 0 0Z"/><circle cx="12" cy="12" r="2"/>',
  orbit: '<ellipse cx="12" cy="12" rx="10" ry="5" transform="rotate(-30 12 12)"/><circle cx="12" cy="12" r="2"/>',
  leaf: '<path d="M19 4C7 3 2 10 6 17c7 5 14-3 13-13ZM6 17 16 7"/>',
  terminal: '<path d="m4 6 6 6-6 6m9 0h7"/>',
  trash: '<path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-5 5 5 5-5m-5 5V3"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8m0-5v5h5m4-1v5l4 2"/>',
};

interface IconProps {
  name: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export const Icon: React.FC<IconProps> = ({ name, size = 16, className, style }) => {
  const pathHtml = iconPaths[name] || iconPaths.turtle;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={style}
      dangerouslySetInnerHTML={{ __html: pathHtml }}
    />
  );
};
