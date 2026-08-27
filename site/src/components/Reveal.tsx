import type { ReactNode, ElementType } from "react";
import { useInView } from "../hooks/useInView";

interface RevealProps {
  children: ReactNode;
  as?: ElementType;
  delay?: number;
  className?: string;
}

export function Reveal({ children, as: Tag = "div", delay = 0, className = "" }: RevealProps) {
  const { ref, inView } = useInView();
  return (
    <Tag
      ref={ref}
      className={`reveal ${inView ? "in-view" : ""} ${className}`.trim()}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
