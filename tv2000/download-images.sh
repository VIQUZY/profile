#!/bin/sh
# Скачивает все картинки лонгрида с Тильды в папку images/.
# Запуск (macOS / Linux): в Терминале перейти в папку проекта и выполнить
#   sh download-images.sh
# Уже скачанные файлы пропускаются, так что можно запускать повторно.

cd "$(dirname "$0")" || exit 1
mkdir -p images

total=0
failed=0
while read -r name url; do
  [ -z "$name" ] && continue
  total=$((total + 1))
  [ -s "images/$name" ] && continue
  echo "$name"
  if ! curl -fsSL --retry 3 -o "images/$name" "$url"; then
    echo "  не скачалось: $url"
    rm -f "images/$name"
    failed=$((failed + 1))
  fi
done < images.txt

echo
if [ "$failed" -eq 0 ]; then
  echo "Готово: все $total картинок лежат в images/"
else
  echo "Не скачалось файлов: $failed из $total. Запусти скрипт ещё раз."
  exit 1
fi
