export default function Skeleton({
    width = "100%",
    height = "20px",
    radius = "4px",
    className = ""
}: {
    width?: string | number,
    height?: string | number,
    radius?: string | number,
    className?: string
}) {
    return (
        <div
            className={`skeleton ${className}`}
            style={{
                width,
                height,
                borderRadius: radius,
                background: "var(--skeleton-bg, rgba(255, 255, 255, 0.1))",
                animation: "skeleton-pulse 1.5s ease-in-out infinite"
            }}
        />
    )
}
