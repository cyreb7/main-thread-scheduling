import ScheduledTask from './ScheduledTask'
import WorkCycleTracker from './WorkCycleTracker'
import SchedulingStrategy from './SchedulingStrategy'
import withResolvers from './utils/withResolvers'
import ReactiveTask from './utils/ReactiveTask'

const strategyPriorities = {
    interactive: 30,
    smooth: 20,
    idle: 10,
}

class ThreadScheduler {
    #tasks: ScheduledTask[] = []
    #topTask: ReactiveTask = new ReactiveTask()
    #workCycleTracker = new WorkCycleTracker()

    constructor() {
        this.#topTask.setEffect(async (task, signal) => {
            this.#workCycleTracker.startTracking()

            await this.#completeTask(task, signal)

            if (this.#tasks.length === 0) {
                this.#workCycleTracker.requestStopTracking()
            }
        })
    }

    createTask(strategy: SchedulingStrategy): ScheduledTask {
        const task = { ...withResolvers(), strategy }

        this.#insertTask(task)

        return task
    }

    isTimeToYield(strategy: SchedulingStrategy): boolean {
        return !this.#workCycleTracker.canWorkMore(strategy)
    }

    async #completeTask(task: ScheduledTask, signal: AbortSignal): Promise<void> {
        while (!this.#workCycleTracker.canWorkMore(task.strategy)) {
            await this.#workCycleTracker.nextWorkCycle(task.strategy)

            if (signal.aborted) {
                return
            }
        }

        task.resolve()

        // - wait for the user code to continue running to see if it will add more work to
        //   be done. we prefer this, over continuing to the next task immediately
        // - if called at the end of an async method, it will wait for the async to get resolved in the
        //   parent method that called it and will execute the provided callback in the next microtask.
        await new Promise<void>((resolve) => {
            queueMicrotask(() => {
                queueMicrotask(() => {
                    resolve()
                })
            })
        })

        this.#removeTask(task)
    }

    #insertTask(task: ScheduledTask): void {
        const priority = strategyPriorities[task.strategy]
        for (let i = 0; i < this.#tasks.length; i++) {
            if (priority >= strategyPriorities[this.#tasks[i]!.strategy]) {
                this.#tasks.splice(i, 0, task)
                this.#topTask.set(this.#tasks[0])
                return
            }
        }
        this.#tasks.push(task)
        this.#topTask.set(this.#tasks[0])
    }

    #removeTask(task: ScheduledTask): void {
        const index = this.#tasks.indexOf(task)
        if (index !== -1) {
            this.#tasks.splice(index, 1)
        }
        if (index === 0) {
            this.#topTask.set(this.#tasks[0])
        }
    }
}

const threadScheduler = new ThreadScheduler()

export default threadScheduler
