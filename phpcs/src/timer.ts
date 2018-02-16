/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

export class Timer {

	/**
	 * Frequency of elapse event of the timer in millisecond
	 */
	public interval = 1000;

	/**
	 * The function to execute on tick.
	 *
	 * @var Function
	 */
	private tick: Function;

	/**
	 * A boolean flag indicating whether the timer is enabled.
	 *
	 * @var boolean
	 */
	private enable: boolean = false;

	// Member variable: Hold interval id of the timer
	private handle: NodeJS.Timer;

	/**
	 * Class constructor.
	 *
	 * @return self.
	 */
	constructor(tick: Function) {
		this.tick = tick;
	}

	/**
	 * Start the timer.
	 */
	public start(): void {
		this.enable = true;
		if (this.enable) {
			this.handle = setInterval(() => {
				this.tick();
			}, this.interval);
		}
	}

	/**
	 * Stop the timer.
	 */
	public stop(): void {
		this.enable = false;
		if (this.handle) {
			clearInterval(this.handle);
		}
	}

	/**
	 * Dispose the timer.
	 */
	public dispose(): void {
		if (this.handle) {
			clearInterval(this.handle);
		}
	}
}
