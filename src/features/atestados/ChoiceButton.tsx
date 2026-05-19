type ChoiceVariant = "ghost" | "primary" | "danger" | "warning"

export function ChoiceButton({
  children,
  variant = "ghost",
  selected = false,
  className = "",
  onMouseMove,
  onMouseLeave,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ChoiceVariant
  selected?: boolean
}) {
  function handleMove(e: React.MouseEvent<HTMLButtonElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    const mx = ((e.clientX - r.left) / r.width) * 100
    const my = ((e.clientY - r.top) / r.height) * 100
    e.currentTarget.style.setProperty("--mx", String(mx))
    e.currentTarget.style.setProperty("--my", String(my))
    onMouseMove?.(e)
  }
  function handleLeave(e: React.MouseEvent<HTMLButtonElement>) {
    e.currentTarget.style.setProperty("--mx", "50")
    e.currentTarget.style.setProperty("--my", "50")
    onMouseLeave?.(e)
  }
  const variantClass =
    variant === "primary"
      ? "choice-btn--primary"
      : variant === "danger"
        ? "choice-btn--danger"
        : variant === "warning"
          ? "choice-btn--warning"
          : ""
  return (
    <button
      {...props}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      className={`choice-btn ${variantClass} ${selected ? "choice-btn--selected" : ""} ${className}`}
    >
      {children}
    </button>
  )
}
