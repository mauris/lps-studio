import { Component, OnInit, OnDestroy, ViewChild, HostListener, ElementRef } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ipcRenderer } from 'electron';
import { SandboxComponent } from '../sandbox/sandbox.component';
import { CanvasObject } from '../sandbox/canvas/CanvasObject';
import { ElectronService } from '../../providers/electron.service';
import { CanvasObjectService } from '../../providers/canvasObject.service';
import { OpenDialogOptions } from 'electron';
import canvasObjectSorter from '../../providers/canvasObjectSorter';
import * as path from 'path';

const timebarHeight = 45; // px

const emptyScreenMessages = [
  'Open a LPS Studio program using the folder icon on the toolbar.',
  'What story will you tell today?',
  '"Life is either a daring adventure or nothing." - Helen Keller'
];

const maxNumberOfHistory = 30;

@Component({
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit, OnDestroy {
  @ViewChild('consoleOutput') consoleOutputView: ElementRef;

  messages: Array<string> = [];

  consoleInput: String;
  currentTime: string = 'No program loaded';

  isDone: boolean = false;
  isPaused: boolean = false;
  isRunning: boolean = false;
  isStopping: boolean = false;
  isMouseDown: boolean = false;
  isConsoleHidden: boolean = false;
  isStatisticsHidden: boolean = false;

  statisticsKeys: Array<string> = [];
  statistics: any = {};
  statisticsHistory: any = {};
  statisticsHistoryMax: any = {};

  statisticsLabel: any = {
    numRules: 'Current Rules',
    numNewRules: 'New Rules',
    numRulesDiscarded: 'Discarded Rules',
    numRulesFired: 'Newly Fired Rules',
    numGoals: 'Unresolved Goals',
    resolvedGoals: 'Resolved Goals',
    failedGoals: 'Failed Goals'
  };

  emptyCanvasMessage: string = emptyScreenMessages[Math.floor(Math.random() * emptyScreenMessages.length)];

  currentFile: string;
  private LPS;
  private windowId: number;

  @ViewChild('sandbox') sandbox: SandboxComponent;

  constructor(
    private titleService: Title,
    private electronService: ElectronService,
    private canvasObjectService: CanvasObjectService
  ) {
    this.LPS = this.electronService.remote.require('lps');
    this.windowId = this.electronService.remote.getCurrentWindow().id;
    this.statisticsKeys = Object.keys(this.statisticsLabel);
  }

  ngOnInit() {
    let imageLoadingPromises = [];
    ipcRenderer.on('canvas:openFile', (event, arg) => {
      this.requestOpenFile();
    });

    ipcRenderer.on('canvas:lpsStart', (event, arg) => {
      this.statistics = {};
      this.statisticsHistory = {};
      this.statisticsHistoryMax = {};

      this.isRunning = true;
      this.sandbox.objects.sort(canvasObjectSorter);
    });

    ipcRenderer.on('canvas:lpsErrorred', (event, arg) => {
      this.consoleLog('Error: ' + arg);
      this.isConsoleHidden = false;
      this.isRunning = false;
    });

    ipcRenderer.on('canvas:lpsWarning', (event, arg) => {
      this.consoleLog('Warning: ' + arg);
    });

    ipcRenderer.on('canvas:lpsHalted', (event, arg) => {
      this.isDone = true;
      this.isStopping = false;
      this.isRunning = false;
      this.currentTime = 'Done';
      this.consoleLog('LPS Program execution complete');
    });

    ipcRenderer.on('canvas:loadImage', (event, arg) => {
      let promise = new Promise((resolve, reject) => {
        let image = this.canvasObjectService.addImage(arg.id, arg.url);
        image.onload = () => {
          resolve();
        }
        image.onerror = () => {
          this.sandbox.objects.splice(0, this.sandbox.objects.length);
          this.canvasObjectService.removeImage(arg.id);
          this.requestStop();
          this.consoleLog('Error: Unable to load image ' + arg.id + ' from ' + arg.url);
          reject();
        };
      });
      imageLoadingPromises.push(promise);
    });

    ipcRenderer.on('canvas:waitImagesLoaded', (event, arg) => {
      Promise.all(imageLoadingPromises)
        .then(() => {
          ipcRenderer.send('lps:canvasImagesLoaded', { windowId: this.windowId });
        });
    })

    ipcRenderer.on('canvas:defineObject', (event, arg) => {
      if (this.canvasObjectService.getObject(arg.id)) {
        this.requestStop();
        this.consoleLog('Error: Duplicated object identifier given for ' + arg.id);
        return;
      }
      let obj = this.canvasObjectService.buildObject(arg);
      if (obj === null) {
        this.requestStop();
        this.consoleLog('Error: Invalid object declaration given for ' + arg.id);
        return;
      }
      if (arg.id !== null) {
        this.canvasObjectService.registerObject(arg.id, obj);
      }
      this.sandbox.objects.push(obj);
    });

    ipcRenderer.on('canvas:updateObject', (event, arg) => {
      let id = arg.id;
      let obj = this.canvasObjectService.getObject(id);
      if (obj === undefined || obj === null) {
        this.requestStop();
        this.consoleLog('Error: Invalid object updating for ' + arg.id);
        return;
      }
      this.canvasObjectService.updateProperties(obj, arg.properties);
      this.sandbox.objects.sort(canvasObjectSorter);
    });

    ipcRenderer.on('canvas:animateObject', (event, arg) => {
      let id = arg.id;
      let obj = this.canvasObjectService.getObject(id);
      if (obj === undefined || obj === null) {
        this.requestStop();
        this.consoleLog('Error: Invalid object animate for ' + arg.id);
        return;
      }
      obj.addAnimations(arg.duration, arg.properties);
    });

    ipcRenderer.on('canvas:lpsTimeUpdate', (event, arg) => {
      let time = arg.time;
      this.currentTime = time;
      this.statistics = arg;
      Object.keys(arg).forEach((key) => {
        if (key === 'time') {
          return;
        }
        let value = arg[key];
        let history = this.statisticsHistory[key];
        if (history === undefined) {
          history = [];
          this.statisticsHistory[key] = history;
        }

        history.push(value);
        if (history.length > maxNumberOfHistory) {
          history.shift();
        }
        this.statisticsHistoryMax[key] = history[0];
        history.forEach((v) => {
          if (v > this.statisticsHistoryMax[key]) {
            this.statisticsHistoryMax[key] = v;
          }
        });
      });
      this.consoleLog('Time ' + time);
    });

    this.sandbox.width = window.innerWidth;
    this.sandbox.height = window.innerHeight - timebarHeight;
  }

  handleCanvasMouseEvent(e: any) {
    if (!this.isRunning || this.isDone) {
      return;
    }
    let eventName = e.event;
    let observations = [];
    let observation: any;
    let theta: any;

    let forEachObjectInPosition = (callback) => {
      this.canvasObjectService
        .iterateObjects((key: string, obj: CanvasObject) => {
          if (obj.isPositionHit(e.x, e.y)) {
            callback(key, obj);
          }
        });
    };

    switch (eventName) {
      case 'click':
        observation = this.LPS.literal('lpsClick(X, Y)');
        theta = {
          X: e.x,
          Y: e.y
        };
        observations.push(observation.substitute(theta));
        forEachObjectInPosition((key, obj) => {
          observation = this.LPS.literal('lpsClick(ObjectId, X, Y)');
          theta.ObjectId = key;
          observations.push(observation.substitute(theta));
        });
        break;
      case 'mousedown':
        observation = this.LPS.literal('lpsMouseDown(X, Y)');
        theta = {
          X: e.x,
          Y: e.y
        };
        observations.push(observation.substitute(theta));
        forEachObjectInPosition((key, obj) => {
          observation = this.LPS.literal('lpsMouseDown(ObjectId, X, Y)');
          theta.ObjectId = key;
          observations.push(observation.substitute(theta));
        });
        break;
      case 'mouseup':
        // reset isDragEnabled for all objects
        theta = {
          X: e.x,
          Y: e.y
        };
        this.canvasObjectService.iterateObjects((key, obj) => {
          if (!obj.isDragEnabled) {
            return;
          }
          // was dragging

          observation = this.LPS.literal('lpsDragRelease(ObjectId, X, Y)');
          theta.ObjectId = key;
          observations.push(observation.substitute(theta));
          obj.endDrag([e.x, e.y]);
        });

        observation = this.LPS.literal('lpsMouseUp(X, Y)');
        theta = {
          X: e.x,
          Y: e.y
        };
        observations.push(observation.substitute(theta));
        forEachObjectInPosition((key, obj) => {
          observation = this.LPS.literal('lpsMouseUp(ObjectId, X, Y)');
          theta.ObjectId = key;
          observations.push(observation.substitute(theta));
        });
        break;
      case 'mousemove':
        if (this.sandbox.isMouseDown) {
          // possibly dragging?
          this.canvasObjectService.iterateObjects((key, obj) => {
            if (!obj.isDragEnabled) {
              return;
            }
            obj.handleDrag([e.x, e.y]);
          });
        }

        observation = this.LPS.literal('lpsMouseMove(X, Y)');
        theta = {
          X: e.x,
          Y: e.y
        };
        observations.push(observation.substitute(theta));
        forEachObjectInPosition((key, obj) => {
          observation = this.LPS.literal('lpsMouseMove(ObjectId, X, Y)');
          theta.ObjectId = key;
          observations.push(observation.substitute(theta));
        });
        break;
    }

    let input = '';
    observations.forEach((observation) => {
      if (input !== '') {
        input += ',';
      }
      input += observation.toString();
    });
    if (input === '') {
      return;
    }
    const data = {
      input: input,
      windowId: this.windowId
    };
    ipcRenderer.send('lps:observe', data);
  }

  consoleLog(message: string) {
    let element = this.consoleOutputView.nativeElement;
    if (element.scrollHeight - element.scrollTop === element.clientHeight) {
      setTimeout(() => {
        element.scrollTop = element.scrollHeight;
      }, 50)
    }
    this.messages.push(message);
  }

  handleCanvasReady() {
  }

  requestPause() {
    if (!this.isRunning || this.isPaused) {
      return;
    }
    this.isPaused = true;
    ipcRenderer.send('lps:pause', { windowId: this.windowId });
    this.consoleLog('Pausing LPS program execution...');
  }

  requestResume() {
    if (!this.isRunning || !this.isPaused) {
      return;
    }
    this.isPaused = false;
    ipcRenderer.send('lps:unpause', { windowId: this.windowId });
    this.consoleLog('Resuming LPS program execution...');
  }

  requestStop() {
    if (!this.isRunning) {
      return;
    }
    this.isStopping = true;
    this.isPaused = false;
    ipcRenderer.send('lps:halt', { windowId: this.windowId });
    this.consoleLog('Stopping LPS program execution...');
  }

  requestRestart() {
    if (this.isRunning || this.currentFile === undefined) {
      return;
    }

    const name = path.basename(this.currentFile);

    this.canvasObjectService.reset();
    this.sandbox.objects = [];

    const data = {
      pathname: this.currentFile,
      windowId: this.windowId
    };
    ipcRenderer.send('lps:start', data);

    this.currentTime = 'Loading ' + name;
    this.consoleLog('Restarting ' + name);
    this.isRunning = true;
    this.isPaused = false;
    this.isDone = false;
  }

  requestOpenFile() {
    if (this.isStopping) {
      return;
    }
    if (this.isRunning) {
      this.requestStop();
      ipcRenderer.once('lps:halted', () => {
        this.requestOpenFile();
      });
      return;
    }
    const dialog = this.electronService.remote.dialog;
    let options: OpenDialogOptions = {
      filters: [
        { name: 'LPS Programs', extensions: ['lps'] }
      ],
      properties: [
        'openFile'
      ]
    };
    let browserWindow = this.electronService.remote.getCurrentWindow();
    dialog.showOpenDialog(browserWindow, options, (filenames) => {
      if (filenames === undefined || filenames.length !== 1) {
        return;
      }

      this.canvasObjectService.reset();
      this.sandbox.objects = [];

      let filename = filenames[0];
      this.currentFile = filename;

      const name = path.basename(this.currentFile);


      this.titleService.setTitle(name + ' - ' + path.dirname(filename));

      const data = {
        pathname: filename,
        windowId: this.windowId
      };
      ipcRenderer.send('lps:start', data);

      this.consoleLog('Starting ' + name);
      this.currentTime = 'Loading ' + name;
      this.isRunning = true;
      this.isPaused = false;
      this.isDone = false;
    });
  }

  toggleConsoleView() {
    this.isConsoleHidden = !this.isConsoleHidden;
  }

  toggleStatisticsView() {
    this.isStatisticsHidden = !this.isStatisticsHidden;
  }

  ngOnDestroy() {
    this.requestStop();
  }

  @HostListener('window:unload', [ '$event' ])
  unloadHandler(event) {
    this.requestStop();
  }

  @HostListener('window:resize', [ '$event' ])
  resizeHandler(event) {
    this.sandbox.width = window.innerWidth;
    this.sandbox.height = window.innerHeight - timebarHeight;
  }

  consoleInputKeypress(event) {
    if (event.keyCode !== 13) {
      return;
    }
    this.consoleLog('Observing "' + this.consoleInput + '"');
    ipcRenderer.send('lps:observe', { input: this.consoleInput, windowId: this.windowId });
    this.consoleInput = '';
  }

}
