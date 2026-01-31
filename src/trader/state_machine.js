export const TRADER_STATES = {
    IDLE: 'IDLE',               // Waiting for Foreman signal or Market start
    ARMED: 'ARMED',             // Market found, waiting for perfect entry criteria (Guardrails)
    ENTERING: 'ENTERING',       // Placing initial FOK orders
    ACCUMULATING: 'ACCUMULATING', // Placing Ladder GTC orders
    LOCKING: 'LOCKING',         // Managing locks (Dual Profit / Breakeven)
    RECOVERY: 'RECOVERY',       // Trying to fix a bad position
    FINAL_SECONDS: 'FINAL_SECONDS', // Last ditch efforts
    DONE: 'DONE'                // Finished for this window
};

export class StateMachine {
    constructor() {
        this.currentState = TRADER_STATES.IDLE;
        this.history = [];
    }

    transitionTo(newState, reason) {
        if (this.currentState !== newState) {
            console.log(`[State Transition] ${this.currentState} -> ${newState} (${reason})`);
            this.history.push({ from: this.currentState, to: newState, reason, timestamp: Date.now() });
            this.currentState = newState;
        }
    }

    getState() {
        return this.currentState;
    }
}
