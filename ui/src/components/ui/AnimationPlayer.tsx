import React, { useState, useEffect, useRef } from "react";
import lottie, { AnimationItem } from "lottie-web/build/player/lottie_light";
import pako from "pako";

interface AnimationPlayerProps {
    src: string;
    className?: string;
    style?: React.CSSProperties;
    loop?: boolean;
    autoplay?: boolean;
}

export const AnimationPlayer = React.memo(
    ({ src, className, style, loop = true, autoplay = true }: AnimationPlayerProps) => {
        const containerRef = useRef<HTMLDivElement>(null);
        const animationRef = useRef<AnimationItem | null>(null);
        const [animationData, setAnimationData] = useState<object | null>(null);

        // Load and decompress TGS / Lottie file
        useEffect(() => {
            const fetchAndDecompress = async () => {
                try {
                    // Add cache busting timestamp
                    const url = `${src}?t=${new Date().getTime()}`;
                    const response = await fetch(url);
                    if (!response.ok) throw new Error(`Failed to fetch ${src}`);
                    const compressed = await response.arrayBuffer();

                    try {
                        // Try to decompress using pako (for .tgs files)
                        const json = pako.inflate(new Uint8Array(compressed), { to: "string" });
                        setAnimationData(JSON.parse(json));
                    } catch (e) {
                        // If decompression fails, it might be a plain JSON lottie file
                        const text = new TextDecoder().decode(compressed);
                        setAnimationData(JSON.parse(text));
                    }

                } catch (err) {
                    console.error("TGS/Lottie parse error:", err);
                }
            };
            fetchAndDecompress();
        }, [src]);

        // Initialize lottie-web animation
        useEffect(() => {
            if (!animationData || !containerRef.current) return;

            // Destroy previous instance if exists
            animationRef.current?.destroy();

            animationRef.current = lottie.loadAnimation({
                container: containerRef.current,
                renderer: "svg", // Changed to SVG for better quality
                loop,
                autoplay,
                animationData,
                rendererSettings: {
                    preserveAspectRatio: 'xMidYMid slice',
                    progressiveLoad: true,
                }
            });

            return () => {
                animationRef.current?.destroy();
            };
        }, [animationData, loop, autoplay]);

        return (
            <div
                ref={containerRef}
                style={style}
                className={`w-full h-full flex items-center justify-center ${className || ""}`}
            />
        );
    }
);

AnimationPlayer.displayName = "AnimationPlayer";
