export function AuroraBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div
        className="aurora-orb"
        style={{
          width: 540,
          height: 540,
          top: "-130px",
          right: "-90px",
          background:
            "radial-gradient(circle at 30% 30%, #6ea0ff 0%, #2a4fd0 45%, transparent 70%)",
          opacity: 0.6,
          animation: "orb-drift-1 14s ease-in-out infinite",
        }}
      />
      <div
        className="aurora-orb"
        style={{
          width: 460,
          height: 460,
          bottom: "-150px",
          left: "-110px",
          background:
            "radial-gradient(circle at 40% 40%, #f0d28a 0%, #c8943a 50%, transparent 72%)",
          opacity: 0.4,
          animation: "orb-drift-2 18s ease-in-out infinite",
        }}
      />
      <div
        className="aurora-orb"
        style={{
          width: 380,
          height: 380,
          top: "55%",
          right: "10%",
          background:
            "radial-gradient(circle at 50% 50%, #e8c275 0%, #8a6420 55%, transparent 75%)",
          opacity: 0.28,
          animation: "orb-drift-3 22s ease-in-out infinite",
        }}
      />
      <div
        className="aurora-orb"
        style={{
          width: 340,
          height: 340,
          top: "18%",
          left: "8%",
          background:
            "radial-gradient(circle at 50% 50%, #b8c5d6 0%, #5a6b85 55%, transparent 78%)",
          opacity: 0.32,
          animation: "orb-drift-4 20s ease-in-out infinite",
        }}
      />
    </div>
  )
}
