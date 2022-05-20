import nextTask from './nextTask'

export type IdlePhase = {
    start: number
    deadline: IdleDeadline
}

// #hack
let shouldRequestAnimationFrame = false

const idlePhaseTracker = createPhaseTracker((callback: (idlePhase: IdlePhase) => void) => {
    const handleIdleCallback = (): void => {
        if (typeof requestIdleCallback === 'undefined') {
            nextTask(() => {
                const start = Date.now()
                const deadline = start + 16
                callback({
                    start,
                    deadline: {
                        didTimeout: false,
                        timeRemaining(): DOMHighResTimeStamp {
                            return Math.max(deadline - Date.now(), 0)
                        },
                    },
                })
            })
        } else {
            requestIdleCallback(
                (deadline) => {
                    shouldRequestAnimationFrame = true

                    callback({
                        deadline,
                        start: Date.now(),
                    })

                    shouldRequestAnimationFrame = false
                },
                {
                    // #WET 2021-06-05T3:07:18+03:00
                    // #connection 2021-06-05T3:07:18+03:00
                    // - call at least once per frame
                    // - assuming 60 fps, 1000/60 = 16.667 = 16.7
                    // - the browser uses around 6ms. the user is left with 10ms:
                    //   https://developer.mozilla.org/en-US/docs/Web/Performance/How_long_is_too_long#:~:text=The%2016.7%20milliseconds%20includes%20scripting%2C%20reflow%2C%20and%20repaint.%20Realize%20a%20document%20takes%20about%206ms%20to%20render%20a%20frame%2C%20leaving%20about%2010ms%20for%20the%20rest.
                    // - because 9*2 is equal to 18, we are sure the idle callback won't be called more than
                    //   once per frame
                    timeout: 9,
                },
            )
        }
    }

    if (shouldRequestAnimationFrame) {
        requestAnimationFrame(() => {
            handleIdleCallback()
        })
    } else {
        handleIdleCallback()
    }
})

export type AnimationPhase = {
    start: number
}

const animationFrameTracker = createPhaseTracker(
    (callback: (animationPhase: AnimationPhase) => void) => {
        requestAnimationFrame(() => {
            callback({ start: Date.now() })
        })
    },
)

type PhaseTracker<T> = {
    getPhase: () => T | undefined
    startTracking: () => void
    stopTracking: () => void
}

function createPhaseTracker<T>(
    requestPhase: (callback: (phase: T) => void) => void,
): PhaseTracker<T> {
    let globalPhase: T | undefined

    // Why the "stop-requested" status?
    // - we request to stop the tracking of IdlePhase because later in a microtask we may call
    //   `startTrackingIdlePhase()` again. all the steps below happen in a single browser task (in
    //   multiple browser micro tasks):
    //   1. `stopTrackingIdlePhase()` is called
    //   2. Promise for `yieldControl()` resolves
    //   3. `yieldControl()` is called again and `startTrackingIdlePhase()` is called
    // - we don't want to cancel with `cancelIdleCallback()` because this would make us call
    //   `requestIdleCallback()` again — this isn't optimal because we can lose free time left in the
    //   currently running idle callback
    let status: 'running' | 'stopped' | 'stop-requested' = 'stopped'

    return {
        getPhase(): T | undefined {
            return globalPhase
        },
        startTracking(): void {
            if (status === 'running') {
                throw new Error('Unreachabe code. This is probably a bug – please log an issue.')
            }

            if (status === 'stop-requested') {
                status = 'running'
                return
            }

            status = 'running'

            requestPhase((phase) => {
                if (status === 'stop-requested') {
                    status = 'stopped'
                    globalPhase = undefined
                } else {
                    globalPhase = phase

                    // setting status to "stopped" so calling startTrackingTaskPhase() doesn't throw
                    status = 'stopped'

                    this.startTracking()
                }
            })
        },
        stopTracking(): void {
            if (status === 'stopped' || status === 'stop-requested') {
                throw new Error('Unreachabe code. This is probably a bug – please log an issue.')
            }

            status = 'stop-requested'
        },
    }
}

export function getIdlePhase(): IdlePhase | undefined {
    const deadline = idlePhaseTracker.getPhase()?.deadline
    const idlePhaseStart = idlePhaseTracker.getPhase()?.start
    const animationFramePhaseStart = animationFrameTracker.getPhase()?.start
    const start =
        typeof requestIdleCallback === 'undefined'
            ? idlePhaseStart
            : animationFramePhaseStart ?? idlePhaseStart

    return start === undefined || deadline === undefined ? undefined : { start, deadline }
}

export function startTrackingPhases(): void {
    idlePhaseTracker.startTracking()
    animationFrameTracker.startTracking()
}

export function stopTrackingPhases(): void {
    idlePhaseTracker.stopTracking()
    animationFrameTracker.stopTracking()
}
