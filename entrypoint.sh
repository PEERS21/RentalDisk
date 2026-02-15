set -euo pipefail
IFS=$'\n\t'

REPO_URL="${REPO_URL:-https://github.com/PEERS21/RentalDisk.git}"
REPO_BRANCH="${REPO_BRANCH:-develop}"
REPO_DIR="/srv/repo"
NODE_VERSION="${NODE_VERSION:-24.13.0}"
MODE="${MODE:-dev}"        # dev | prod
APP_PORT="${APP_PORT:-3000}"
SCRIPT="${SCRIPT:-dev}"

# NVM bootstrap
export NVM_DIR="${NVM_DIR:-/root/.nvm}"
# shellcheck source=/dev/null
if [ -s "${NVM_DIR}/nvm.sh" ]; then
  # загружаем nvm в этот shell
  . "${NVM_DIR}/nvm.sh"
else
  echo "nvm не найден в ${NVM_DIR}, пробую установить временно..."
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.6/install.sh | bash
  . "${NVM_DIR}/nvm.sh"
fi

# Установка / использование требуемой node-версии (если ещё не установлена)
if ! nvm ls "${NODE_VERSION}" >/dev/null 2>&1; then
  echo "Установка node ${NODE_VERSION} через nvm..."
  nvm install "${NODE_VERSION}"
fi
nvm use "${NODE_VERSION}" || nvm alias default "${NODE_VERSION}" && nvm use default

# Клонируем репозиторий (или обновляем)
if [ ! -d "${REPO_DIR}/.git" ]; then
  echo "Клонирую ${REPO_URL} -> ${REPO_DIR} (branch ${REPO_BRANCH})"
  git clone --depth 1 --branch "${REPO_BRANCH}" "${REPO_URL}" "${REPO_DIR}"
else
  echo "Репозиторий уже существует в ${REPO_DIR}, обновляю ветку ${REPO_BRANCH}"
  cd "${REPO_DIR}"
  git fetch origin "${REPO_BRANCH}"
  git checkout "${REPO_BRANCH}"
  git pull --ff-only origin "${REPO_BRANCH}" || true
fi

cd "${REPO_DIR}"

# Устанавливаем зависимости (npm ci если есть package-lock.json)
if [ -f package-lock.json ]; then
  echo "Выполняю npm ci"
  npm ci
else
  echo "Выполняю npm install (package-lock.json не найден)"
  npm install
fi

# Запуск в зависимости от режима
if [ "${MODE}" = "dev" ]; then
  echo "Запуск dev-сервера: HOST=0.0.0.0 PORT=${APP_PORT} npm run ${SCRIPT}"
  # Обеспечиваем что CRA слушает 0.0.0.0
  export HOST=0.0.0.0
  export PORT="${APP_PORT}"
  exec npm run "${SCRIPT}"
else
  # prod: собираем и подаем статически через npx serve (или оставляем как есть, если проект сам обслуживает)
  echo "Production mode: собираю проект и запускаю статический сервер на порту ${APP_PORT}"
  npm run "${SCRIPT}" || true   # предполагаем, что SCRIPT будет 'build' для prod
  # используем npx serve чтобы не держать глобально установленный пакет
  echo "Запускаю: npx serve -s build -l ${APP_PORT}"
  exec npx serve -s build -l "${APP_PORT}"
fi
