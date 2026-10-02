# Быстрый запуск обновления

1. Распакуйте архив. Это обновление прежнего сайта: дизайн сохранён.
2. Создайте Neon PostgreSQL, получите pooled DATABASE_URL.
3. На компьютере с Node.js 22: `npm ci`, скопируйте `.env.example` в `.env`, заполните DATABASE_URL, REGISTRATION_SECRET, IP_HASH_SECRET. Для локального запуска APP_ORIGIN=http://localhost:3000.
4. `npm run migrate`.
5. `npm run admin:create -- --slot 1 --email ВАШ_EMAIL` и аналогично слот 2 с email Сергея. Пароли вводятся скрыто в терминале.
6. Замените исходники в вашем GitHub-репозитории. Удалите старые Supabase-файлы, перечисленные в README. Не публикуйте `.env`.
7. В существующем Vercel подключите репозиторий: Other, public, Node.js 22, `npm ci`, Build Command пустой. Добавьте три серверные переменные. APP_ORIGIN на Vercel оставьте пустым или укажите точный HTTPS-адрес.
8. Deploy, затем проверьте форму, окно участия и вход обоих администраторов.

Подробности, безопасность, замена старой версии и проверки — в README.md.
