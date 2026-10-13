/**
 * Placeholder app logo until the real SVG arrives: the Nassau app icon and the name, in the same
 * signal green and size as the Voyager logos. Swap for an <img> of the logo file when it's ready.
 */
export function Logo() {
  return (
    <span className="cv-logo" aria-hidden>
      <svg viewBox="0 0 68 68" width="25" height="25">
        <path
          fill="currentColor"
          fillRule="evenodd"
          d="M68.21 55.43c-3.51-2.13-6.46-5.15-8.57-8.8a26 26 0 0 1-3.45-12.81c0-12.18-9.68-22.06-21.61-22.06S12.96 21.64 12.96 33.83v10.14c0 6.57 6 11.9 13.38 11.9-3.02-3.09-4.46-6.63-4.46-11.9l.01-10.16c0-7.15 5.69-12.96 12.7-12.96 7 0 12.7 5.8 12.7 12.96 0 11.95 9.3 21.64 20.92 22.01v11.99H0V0h68.21v55.43ZM35.25 26.44c-.16-.69-1.14-.69-1.3 0l-1.21 5.39a.67.67 0 0 1-.5.5l-5.4 1.22c-.69.16-.69 1.14 0 1.3l5.4 1.21c.25.06.45.26.5.5l1.21 5.4c.16.69 1.14.69 1.3 0l1.21-5.4c.06-.24.26-.44.5-.5l5.4-1.21c.69-.16.69-1.14 0-1.3l-5.4-1.22a.67.67 0 0 1-.5-.5l-1.21-5.39Z"
        />
      </svg>
      <span className="cv-logo-word">
        <b>Creator</b> Vellum
      </span>
    </span>
  );
}
