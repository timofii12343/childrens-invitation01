-- Выполнять вручную только когда мероприятие завершено и данные больше не нужны.
-- Удаляет ВСЕ заявки, включая действующие, и все сессии/события лимитов.
-- Администраторы остаются; рабочая база НЕ очищается автоматически.
BEGIN;
DELETE FROM invitation_sessions;
DELETE FROM invitation_rate_events;
DELETE FROM invitation_registrations;
COMMIT;
