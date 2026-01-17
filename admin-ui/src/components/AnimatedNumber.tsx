import { CountUp } from 'use-count-up'
import { useRef, useEffect } from 'react'

interface AnimatedNumberProps {
  value: number
}

export function AnimatedNumber({ value }: AnimatedNumberProps) {
  const prevValueRef = useRef(value)

  // Read previous value BEFORE effect updates it
  const startValue = prevValueRef.current

  // Update ref AFTER render commits - this is the key!
  // By updating in useEffect, we ensure the ref always has
  // the "last committed" value, not a mid-render value
  useEffect(() => {
    prevValueRef.current = value
  }, [value])

  return (
    <CountUp
      key={value}          // Forces new CountUp instance when value changes
      isCounting
      start={startValue}   // Animate FROM the previous value
      end={value}          // TO the current value (always shows this at completion)
      duration={0.3}
    />
  )
}
