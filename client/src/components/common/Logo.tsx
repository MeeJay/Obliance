import { useCurrentTheme } from '@/hooks/useCurrentTheme';

interface LogoProps {
  className?: string;
  alt?: string;
}

/**
 * Obliance wordmark that adapts to the active theme. The default `logo.svg`
 * has a white wordmark (for the dark themes); the Obli Daylight light theme
 * needs the black-wordmark variant so it stays legible on the light chrome.
 * Both SVGs share the same viewBox, so they are drop-in interchangeable.
 */
export function Logo({ className, alt = 'Obliance' }: LogoProps) {
  const theme = useCurrentTheme();
  const src = theme === 'obli-daylight' ? '/logo-daylight.svg' : '/logo.svg';
  return <img src={src} alt={alt} className={className} />;
}
