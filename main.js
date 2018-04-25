const {app, BrowserWindow, ipcMain, Menu } = require('electron')
const path = require('path')
const url = require('url')
const fs = require('fs');
const ytdl = require('ytdl-core');
const clipboardWatcher = require('electron-clipboard-watcher');
const ffmpegPath = require('ffmpeg-static').path;
const ffmpeg = require('fluent-ffmpeg');

require('dotenv').config();
ffmpeg.setFfmpegPath(ffmpegPath);
DOWNLOAD_PATH = "./download";

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win

// Menu
const templateMenu = [
  {
    role: 'window',
    submenu: [
      {role: 'minimize'},
      {role: 'zoom'},
      {type: 'separator'},
      {role: 'front'}
    ]
  }
]

if (process.platform === 'darwin') {
  const name = app.getName()
  templateMenu.unshift({
    label: name,
    submenu: [
      {role: 'about'},
      {type: 'separator'},
      {role: 'services'},
      {type: 'separator'},
      {role: 'hide'},
      {role: 'hideothers'},
      {role: 'unhide'},
      {type: 'separator'},
      {role: 'quit'}
    ]
  })
}

function createWindow () {
  // Create the browser window.
  win = new BrowserWindow({
      width: 360, 
      height: 540,
      title: "Rekord",
      titleBarStyle: 'hiddenInset', 
      transparent: true, 
      frame: false, 
      resizable: false,
      maximizable: false,
      center: true,
      webPreferences: {
        webSecurity: false
      },
      icon: path.join(__dirname, 'src/assets/icons/png/64x64.png')
    })

  // Specify entry point
  if (process.env.PACKAGE === 'true'){
    win.loadURL(url.format({
      pathname: path.join(__dirname, 'dist', 'index.html'),
      protocol: 'file:',
      slashes: true
    }));
  } else {
    win.loadURL(process.env.HOST);
    win.webContents.openDevTools();
  }

  // Emitted when the window is closed.
  win.on('closed', () => {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    win = null
  })

  const menu = Menu.buildFromTemplate(templateMenu)
  Menu.setApplicationMenu(menu)
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {
    createWindow();
    // Create download folder if not exist
    if (!fs.existsSync(DOWNLOAD_PATH)){
        fs.mkdirSync(DOWNLOAD_PATH);
    }
  });

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (win === null) {
    createWindow()
  }
})

// On Download event
// Emit by Angular application
ipcMain.on('download', (event, args) => {
  let video;
  let starttime;
  let filename = args.info.title.replace(/[^A-Z1-2-]/gi, '_').replace(/_/g, '_');
  let ext = '.mp4';

  // Constructor Youtube Downloader
  video = ytdl(args.url, { filter: 'audioonly' });
  video.pipe(fs.createWriteStream(DOWNLOAD_PATH + '/' + filename + ext));
  
  // On response emit
  video.once('response', () => {
    // Emit start event to Angular application
    ipcMain.emit('start');
    // Init timestamp
    starttime = Date.now();
    
  });
  
  // On progress emit
  video.on('progress', (chunkLength, downloaded, total) => {
      const floatDownloaded = downloaded / total;
      const downloadedMinutes = (Date.now() - starttime) / 1000 / 60;
      // Emit progress event to Angular application with progress infos
      ipcMain.emit('progress', {percent: (floatDownloaded * 100).toFixed(2), remainingminute: downloadedMinutes ,download: downloaded, t: total});
    });
  
  // On end event
  video.on('end', () => {
    // Convert mp4 to mp3
    // Callback ==> success : Boolean, err : Object
    convertToMP3(DOWNLOAD_PATH + '/' + filename, ext, (success, err) => {
      if(success){
        // Emit end event to Angular application
        ipcMain.emit('end');
      }
      if (err !== null){
        // If error, emit end event to Angular application with error object
        ipcMain.emit('end', err);
      }
    });
  });
})

// clipboardWatcher constructor
clipboardWatcher({
  // (optional) delay in ms between polls
  watchDelay: 100,
  // handler for when text data is copied into the clipboard
  onTextChange: function (u) {
    let regExp = RegExp('^(http(s)?:\/\/)?((w){3}.)?youtu(be|.be)?(\.com)?\/.+');
    if(regExp.test(u)){
      ipcMain.emit('clipboard', {url: u});
    }
  }
})

/**
 * convertToMP3 function
 * convert any video/audio file to MP3
 * @param {string} file 
 * @param {object} callback 
 */
function convertToMP3(file, ext, callback){
  try {
    var command = ffmpeg(file + ext)
      .toFormat('mp3')
      .saveToFile(file + '.mp3')
      .on('progress', function(progress) {
        //  progress // {"frames":null,"currentFps":null,"currentKbps":256,"targetSize":204871,"timemark":"01:49:15.90"}
        //console.log('Processing: ' + progress.timemark + ' done ' + progress.targetSize+' kilobytes' + 'Processing: ' + progress.percent + '% done');
        // Emit conversion progress
        ipcMain.emit('convert', {percent: progress.percent});

      })
      .on('end', () => {
        fs.unlink(file + ext, (err) => {
          if (err) throw err;
          callback(true, null);
        });
      });
  } catch (e) {
    callback(null, {error: e});
  }
}
