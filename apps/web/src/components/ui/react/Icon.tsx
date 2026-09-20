import { cx } from "../attrs";
import { type IconName, type IconSize, iconPaths } from "../icons";

interface IconProps {
  name: IconName;
  size?: IconSize;
  className?: string;
}

/** Decorative icon. Put the meaning in nearby text, not in the icon. */
export function Icon({ name, size = "md", className }: IconProps) {
  return (
    <svg
      className={cx("ni-icon", className)}
      data-size={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {iconPaths[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
