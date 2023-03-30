import { Injectable } from '@angular/core';
import { ButtplugClientDevice, ButtplugClient, ButtplugNodeWebsocketClientConnector } from 'buttplug';
import { Subject } from 'rxjs';
import { throttleTime } from 'rxjs/operators';

/**
 * Currently, the Buttplug library mustn't get minified. To avoid having the whole project unminified, the library is included as additional
 * script and not usual import.
 */

 /**
  * Devices can't handle multiple requests at once and we don't know when they have processed the previous request. But hopefully they have
  * after this time span.
  */
 const THROTTLE_TIME = 250;

@Injectable({
    providedIn: 'root'
})
export class DeviceService {

    public connectedDevices: ButtplugClientDevice[] = [];
    public deviceChanges$ = new Subject<{event: 'connected' | 'disconnected', device: ButtplugClientDevice}>();
    public errors$ = new Subject<Error>();

    private _intensity$ = new Subject<number>();
    public get intensity$(): Subject<number> {
        return this._intensity$;
    }

    private readonly connector = new ButtplugNodeWebsocketClientConnector('ws://localhost:12345');
    private readonly client = new ButtplugClient('Ahegao Detector');
    private clientConnected = false;
    private inPriority = false;

    constructor() {
        this.client.addListener('deviceadded', this.onDeviceAdded.bind(this));
        this.client.addListener('deviceremoved', this.onDeviceRemoved.bind(this));
    }

    public async connect(): Promise<void> {
        try {
            if (!this.clientConnected) {
                await this.client.connect(this.connector);
                this.clientConnected = true;
            }

            this.intensity$.pipe(
                throttleTime(THROTTLE_TIME, undefined, {leading: false, trailing: true})
            ).subscribe((intensity) => this.sendIntensity(intensity));

            await this.client.startScanning();
        } catch (e) {
            this.errorHandler(e);
        }
    }

    /**
     * Sets the intensity (vibration, stroking speed, etc.) of all connected devices
     * @param intensity Value between 0 and 1
     * @param priority If set to true, the intensity remains until an other call with priority was made.
     */
    public async setIntesity(intensity: number, priority = false): Promise<void> {
        try {
            if (this.inPriority && !priority) {
                return;
            }
            if (priority) {
                this.inPriority = intensity > 0;
            }

            this._intensity$.next(intensity);

        } catch (e) {
            this.errorHandler(e);
        }
    }

    /**
     * Stops all devices. Intended to be used when the user closes the tab.
     */
    public async forceStop(): Promise<void> {
        await this.setIntesity(0, true);
        // Immediately send command without waiting for throttle
        await this.sendIntensity(0);
    }

    private async sendIntensity(intensity: number): Promise<void> {
        if (intensity <= 0) {
            // Stop all
            for (const device of this.connectedDevices) {
                await device.stop();
            }
            return;
        }
        for (const device of this.connectedDevices) {
            if (device.eventNames().includes('VibrateCmd')) {
                await device.vibrate(intensity);
            }
            // TODO: Other types
        }
    }

    private onDeviceAdded(device: ButtplugClientDevice): void {
        this.connectedDevices.push(device);
        this.deviceChanges$.next({event: 'connected', device});
    }

    private onDeviceRemoved(device: ButtplugClientDevice): void {
        const index = this.connectedDevices.indexOf(device);
        this.connectedDevices.splice(index, 1);
        this.deviceChanges$.next({event: 'disconnected', device});
    }

    private errorHandler(error: Error): void {
        console.error(error);

        // Don't display "GATT operation already in progress.". That error happens when the previous request isn't processed yet, but you
        // can still use the device as usual afterwards.
        if (error.message.includes('GATT operation already in progress.')) {
            return;
        }

        this.errors$.next(error);
    }
}
