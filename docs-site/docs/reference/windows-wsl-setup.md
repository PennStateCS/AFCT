# Windows: keep the checkout inside WSL

On Windows, put the AFCT repository inside the WSL 2 filesystem rather than on `C:`. This is optional, but it is the difference between a first page load that takes a minute and a half and one that takes a second.

## Why

The development stack runs in Docker, and Docker Desktop runs on WSL 2. When the repository sits on `C:`, the container reads every source file across the boundary between Linux and Windows. File change events do not cross that boundary either, so webpack has to poll for changes instead of being told about them.

Measured on one developer's machine, on the same commit and the same hardware:

| Where the checkout lives    | First `GET /login` | Of that, Next.js compile |
| --------------------------- | ------------------ | ------------------------ |
| `C:\Users\you\Desktop\afct` | 105 s              | 89 s                     |
| `~/afct` inside WSL         | 1.4 s              | 0.12 s                   |

Nothing in the repository changes. This is only about where you clone it.

## Before you start

You need about 30 minutes, an internet connection, and around 5 GB of free disk space.

You will still use Windows applications. VS Code runs on Windows as usual and connects into WSL. Only the files and the development stack move.

## Step 1: Install a Linux distribution

Docker Desktop installs a distribution called `docker-desktop`, but that one is managed by Docker and gets replaced when Docker updates. You need your own.

Open PowerShell and run:

```powershell
wsl --install -d Ubuntu
```

Restart your computer when it asks.

After the restart, open Ubuntu from the Start menu. The first launch asks you to create a username and password. These are separate from your Windows account. Pick something you will remember, because you need the password for `sudo` later.

Confirm it worked:

```powershell
wsl -l -v
```

You should see `Ubuntu` listed with `VERSION 2`.

## Step 2: Let Docker use the distribution

1. Open Docker Desktop.
2. Go to Settings, then Resources, then WSL Integration.
3. Turn on the toggle for `Ubuntu`.
4. Click Apply and Restart.

Confirm it worked. Open Ubuntu from the Start menu and run:

```bash
docker version
```

You should see both a Client and a Server section. If you get "command not found" or "cannot connect to the Docker daemon", the toggle did not apply. Go back to step 2.

## Step 3: Install Node

The `npm` scripts have to run inside Ubuntu, so Ubuntu needs its own copy of Node. Do not skip this. Windows has its own Node, and Ubuntu can sometimes see it through the shared PATH, which produces confusing failures.

In Ubuntu:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource.sh
```

```bash
sudo -E bash /tmp/nodesource.sh && sudo apt-get install -y nodejs
```

Confirm you are using Ubuntu's copy and not the Windows one:

```bash
which node && node -v
```

The path must start with `/usr/bin`. If it starts with `/mnt/c`, Ubuntu is reaching into Windows and something went wrong above.

## Step 4: Set up Git

In Ubuntu, with your own name and address:

```bash
git config --global user.name "Your Name"
```

```bash
git config --global user.email "you@psu.edu"
```

Set line endings to the Linux convention. Windows checkouts use a different setting, and this is the correct one here:

```bash
git config --global core.autocrlf input
```

Install the GitHub CLI and sign in, so you can push:

```bash
sudo apt-get install -y gh && gh auth login
```

Choose GitHub.com, then HTTPS, then answer yes to authenticating Git with your credentials, then log in with a web browser. It shows you a one-time code to paste into the browser.

## Step 5: Clone the repository

Clone it into your Linux home directory. Do not clone into `/mnt/c`, and do not copy your existing Windows checkout across. A fresh clone avoids dragging several gigabytes of `node_modules` through the slow path for no reason.

```bash
cd ~ && git clone https://github.com/PennStateCS/AFCT.git afct
```

```bash
cd ~/afct
```

## Step 6: Bring across your environment file

`.env.development` is not in the repository, so the clone does not have one. If you already have a working checkout on `C:`, copy yours across rather than filling in a new one.

Windows drives are available inside Ubuntu under `/mnt/`, so `C:\Users\yourname\Desktop\afct` is `/mnt/c/Users/yourname/Desktop/afct`. Adjust the path below to wherever your old checkout actually is:

```bash
cp /mnt/c/Users/yourname/Desktop/afct/.env.development ~/afct/.env.development
```

Check it arrived, without printing the contents, since the file holds secrets:

```bash
ls -l ~/afct/.env.development
```

If you do not have an existing checkout, start from the example instead:

```bash
cp .env.development.example .env.development && nano .env.development
```

The example file documents each variable. See [Development setup](./development-setup.md) for what to change.

Two other files are worth copying the same way if your old checkout has them, since neither is in the repository:

```bash
cp /mnt/c/Users/yourname/Desktop/afct/CLAUDE.md ~/afct/CLAUDE.md
```

```bash
cp -r /mnt/c/Users/yourname/Desktop/afct/docs ~/afct/docs
```

## Step 7: Start the stack

```bash
npm run docker:dev
```

The first run installs dependencies and applies migrations, so give it a few minutes. Wait for `Ready in`, then open http://localhost:3000 in your normal Windows browser. Ports still reach Windows in the usual way.

Press Ctrl+C in that terminal to stop the stack.

## Step 8: Connect VS Code

Install the WSL extension. In PowerShell:

```powershell
code --install-extension ms-vscode-remote.remote-wsl
```

Then, from Ubuntu, in the repository:

```bash
code .
```

VS Code opens as a normal Windows window. Check the bottom left corner. It must say `WSL: Ubuntu`. If it does not, you have opened the Windows copy and none of the speed applies.

Two things to do on first open:

1. A yellow banner asks whether you trust the folder. Click Trust. Until you do, VS Code runs in Restricted Mode and ESLint and Prettier will not run.
2. Open the Extensions panel. Extensions that read your code, such as ESLint, Prettier, Prisma, and Tailwind, have to be installed inside WSL as well as on Windows. Look for the blue "Install in WSL: Ubuntu" buttons and click them.

After this, use the built in terminal with Ctrl and the backtick key. It opens a shell that is already inside Ubuntu, in the repository.

## Everyday use

- Open the project from VS Code with File, then Open Recent. It appears as `~/afct [WSL: Ubuntu]`.
- Run every command, including Git and npm, from the built in terminal or an Ubuntu window. Running them from PowerShell against `\\wsl$\` works but is slower.
- To reach the files from Windows applications, use `\\wsl$\Ubuntu\home\yourname\afct` in File Explorer.

## If you already have a checkout on C:

You can keep both. They do not interfere as long as you never run the stack from both at the same time.

Both folders are named `afct`, so Docker Compose gives them the same project name and they share the same containers, volumes, and database. Starting the stack in one while the other is running causes both to fight over the same resources. Stop one before starting the other.

Because they share the database volume, your existing development data appears in the new checkout with no migration needed.

Once you are confident in the new setup, delete the old folder so you do not open it out of habit.

## Troubleshooting

**`cd ~/afct` fails with "Cannot find path".** You are still in PowerShell. Run `wsl -d Ubuntu` first. The prompt changes from `PS C:\...>` to `yourname@machine:~$`.

**Compiles are still slow.** Check the bottom left of VS Code for `WSL: Ubuntu`, and run `pwd` in the terminal. If it prints something starting with `/mnt/c`, you are working on the Windows copy.

**`sudo` asks for a password you do not have.** Set one from PowerShell, which runs as root and does not ask for the old password:

```powershell
wsl -d Ubuntu -u root passwd yourname
```

**Docker commands fail inside Ubuntu.** WSL Integration in Docker Desktop is off, or was turned on for a different distribution. See step 2.

## Notes on `.wslconfig`

WSL reads an optional `C:\Users\yourname\.wslconfig` for memory and CPU limits. Two things catch people out:

- Backslashes are escape characters in this file. Write paths with forward slashes, or leave the setting out.
- A path at the root of `C:` needs administrator rights to create. If you set `swapFile` there, WSL fails silently and you end up with no swap. Leaving `swapFile` unset is the safe choice, because WSL then puts it somewhere it can always write.

Both failures are silent. Check your settings applied by running `nproc` and `free -g` inside Ubuntu.
