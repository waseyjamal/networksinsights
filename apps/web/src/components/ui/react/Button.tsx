import type { AnchorHTMLAttributes, ButtonHTMLAttributes, MouseEvent } from "react";
import { type ButtonVariant, buttonAttrs, type ControlSize, cx } from "../attrs";

interface Common {
  variant?: ButtonVariant;
  size?: ControlSize;
  loading?: boolean;
}

export type ButtonProps = Common & ButtonHTMLAttributes<HTMLButtonElement>;
export type ButtonLinkProps = Common & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

const Spinner = () => <span className="ni-btn__spinner" aria-hidden="true" />;

export function Button({
  variant,
  size,
  loading,
  className,
  children,
  type = "button",
  onClick,
  ...rest
}: ButtonProps) {
  // While loading the button stays focusable but does nothing.
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (loading) event.preventDefault();
    else onClick?.(event);
  };
  return (
    <button
      className={cx("ni-btn", className)}
      type={type}
      onClick={handleClick}
      {...buttonAttrs({ variant, size, loading })}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

/** A link (<a>) that looks like a button. */
export function ButtonLink({
  variant,
  size,
  loading,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <a className={cx("ni-btn", className)} {...buttonAttrs({ variant, size, loading })} {...rest}>
      {loading && <Spinner />}
      {children}
    </a>
  );
}
