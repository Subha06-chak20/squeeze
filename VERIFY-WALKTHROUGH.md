# SqueezeIt — click-by-click guide for a new Windows PC

This guide is for someone who has never installed or compressed anything.
You only need the zip file and a Windows computer. You do not need an
account, the internet, or any special knowledge.

The file you receive is one zip:

**`SqueezeIt-<version>-windows.zip`**

For example: `SqueezeIt-1.0.0-windows.zip`. The numbers change with each
release.

---

## Steps, in order

### Step 1 — Take the files out of the zip

1. Find the zip file where you saved it (often in Downloads).
2. **Right-click** the zip file.
3. Click **Extract All…**
4. In the window that opens, choose **Desktop** as the place to extract.
5. Click **Extract**.

**What you should see:** a new folder named **SqueezeIt** appears on your
Desktop. Open it and you will see several files. Only one of them is meant to
be double-clicked; the rest are left alone.

> Do not try to run anything from inside the zip. Always extract first.

---

### Step 2 — Open the SqueezeIt folder

Double-click the **SqueezeIt** folder on your Desktop.

**What you should see:** files including **Start SqueezeIt** with a small
scroll-like script icon, plus text files and folders. Windows often hides the
`.vbs` at the end of the name, so the file may simply read **Start SqueezeIt**.
That is the correct file.

---

### Step 3 — Start SqueezeIt

Double-click **Start SqueezeIt** (the script icon).

**What you should see:** nothing happens for a moment — this is normal, the
black console window is intentionally hidden. Then your web browser opens a
page called **SqueezeIt** whose address begins with `http://127.0.0.1:`.

If the browser does not open within about 10 seconds, go to
"What to do if something goes wrong" below.

---

### Step 4 — If Windows warns you

If a window appears that says **"Windows protected your PC"**:

1. Click **More info**.
2. Click **Run anyway**.

**What you should see:** the SqueezeIt page then opens in your browser.

If you do not see that warning, skip this step.

---

### Step 5 — Check the new Desktop icon

Look at your Desktop. A new icon named **SqueezeIt** has appeared.

To check where it points:

1. **Right-click** the **SqueezeIt** icon.
2. Click **Properties**.
3. Look at the box labelled **Target**. It should end with
   `\SqueezeIt\Start SqueezeIt.vbs`.
4. Click **Cancel** to close the window.

**What you should see:** the target ends with the SqueezeIt folder and
`Start SqueezeIt.vbs`. This icon is the one you will use from now on to start
the app.

---

### Step 6 — The welcome panel (first time only)

On the very first launch, the SqueezeIt page shows a short welcome panel with
three steps and a **Got it** button.

Click **Got it**.

**What you should see:** the main page with two large buttons:
**Choose files** and **Choose a folder**, and the line
"Your files stay on this computer."

On later launches this welcome panel is skipped.

---

### Step 7 — Choose what to make smaller

Click **Choose files** or **Choose a folder**.

- If you clicked **Choose files**, a Windows dialog opens. Click the files
  you want (videos or pictures), then click **Open**.
- If you clicked **Choose a folder**, a folder picker opens. Select a folder,
  then click **Select Folder**. SqueezeIt looks inside it, including
  subfolders.

**What you should see:** the SqueezeIt page shows a list of your files. Each
row shows the file name, its original size, about how small it will get, and a
sentence such as "Will get about 60% smaller. Expected to look the same." A
PDF or other unsupported file is shown as
**"Not supported in this version."**

There is one slider labelled **Smaller file ←→ Better quality**. Leave it in
the middle. There is a big **Make files smaller** button. Nothing has happened
to your files yet.

If you need each copy to fit a particular size (for example, a 25 MB limit),
open **More options** and type the number in **Maximum size per file**, then
choose KB, MB or GB. The slider is then ignored: SqueezeIt aims for the biggest
file that still fits under your limit. Files already under the limit are left
alone. Leave the box empty when you do not need a limit.

---

### Step 8 — Make the files smaller

Click the big **Make files smaller** button.

**What you should see:** the page changes to "Working on 1 of …" with a
progress bar and an estimate in minutes. When it finishes, the page says
**"Done!"** and shows something like
"20 file(s) went from 2.4 GB to 900 MB." There are three buttons:
**Save all…**, **Open temporary folder** and **Make more**.

If something could not be compressed, it is listed below under
"These files need a look" with the reason.

---

### Step 9 — Save the copies you want to keep

Nothing has been saved to your own folders yet. The new copies sit in a
temporary folder while SqueezeIt is open, and the page says so.

1. To keep one file, click **Save** beside that file in the list. A normal
   Windows save window opens; choose a folder and a name, then click **Save**.
2. To keep all of them, click **Save all…** and choose a folder.

**What you should see:** the page changes to "Saved to: <your folder>" (or
"1 of 3 saved to: …" after saving a single row). Inside the folder you chose
are copies with " (smaller)" added to their names, such as
`holiday (smaller).mp4`. Your original files are unchanged and still in their
original place.

If you close SqueezeIt without saving, the temporary copies are deleted. This
is deliberate: the app never writes anything beside your originals unless you
ask it to.

---

## File map — what every file is and whether to click it

| Name | What it is | Should you click it? |
|---|---|---|
| `Start SqueezeIt.vbs` (shows as "Start SqueezeIt") | The only launcher | **YES — double-click this** |
| Desktop icon "SqueezeIt" | A shortcut to the launcher above | **YES — double-click this** |
| `START-HERE.txt` | A copy of the plain instructions | Do not click |
| `LICENSE` | The software license text | Do not click |
| `LICENSES.txt` | Details about the tools inside | Do not click |
| `SHA256SUMS.txt` | A list of file fingerprints for checking | Do not click |
| `node\node.exe` | The app's private copy of Node.js | Do not click |
| `bin\ffmpeg.exe` | The video and picture engine | Do not click |
| `bin\ffprobe.exe` | The file inspector | Do not click |
| `app\server.mjs` | The app's local server | Do not click |
| `app\public\index.html` | The page you see in the browser | Do not click |
| `app\public\app.js` | The page's buttons and behavior | Do not click |
| `app\public\style.css` | The page's colors and text sizes | Do not click |
| `app\lib\*.mjs` | The app's internal helpers | Do not click |
| `%TEMP%\SqueezeIt\job-…` (created while a batch runs) | Temporary copies waiting to be saved | You normally do not need to open this. Use **Open temporary folder** if you are curious. |

Only **Start SqueezeIt.vbs** and the **SqueezeIt** desktop icon are for you to
double-click. Everything else is part of the machinery.

---

## Where things go

| Place | What lives there | May you move it? |
|---|---|---|
| The `SqueezeIt` folder (Desktop after Step 1) | The whole application | You may move the whole folder, but **do not move any file out of it**. The files must stay together. |
| A folder you pick when you click **Save** | Your new, smaller copies | Yes — move or copy these files anywhere you like. |
| `%TEMP%\SqueezeIt` | Temporary copies while the app is open; emptied on the next batch and deleted when SqueezeIt closes | Do not rely on it. Save anything you want to keep. |
| `%APPDATA%\SqueezeIt` (a hidden place Windows keeps app settings) | Settings, a short log, and the memory that the Desktop icon was made | Do not touch. It is created automatically. Deleting it just resets the welcome panel and Desktop icon. |

Nothing is written inside the `SqueezeIt` folder while the app runs.

---

## What to do if something goes wrong

- **A message says a file is missing or was blocked:** restore the named file
  from your antivirus quarantine, add the whole SqueezeIt folder as an
  exception, then double-click Start SqueezeIt again.
- **The browser does not open:** wait 10 seconds, then double-click
  Start SqueezeIt again. If it still does not open, restart the computer and
  try once more.
- **Windows says "Windows protected your PC":** click More info, then Run anyway.
  This is normal for a new free app that has not paid for a publisher certificate.
- **Your antivirus removes or blocks a file:** restore it, add the SqueezeIt
  folder as an exception, then start the app again. Nothing was uploaded.
- **The Desktop icon is missing:** open the SqueezeIt folder and double-click
  Start SqueezeIt. Starting it once usually creates the icon again.
- **The app does not stop after you close the browser tab:** it closes itself
  about a minute later. If it has not, right-click the SqueezeIt icon in the
  taskbar notification area and choose Close, or restart the computer. Your
  files are safe either way.

---

*No command line is needed at any point. If any step above ever asks you to
type a command, that is a mistake in the app design — please report it.*
