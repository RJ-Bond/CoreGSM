# Наблюдение за панелью: Prometheus и Grafana

Панель отдаёт своё состояние в формате Prometheus. Здесь готовая панель Grafana и правила оповещений.

## 1. Включить метрики

В `.env` панели задайте длинный случайный токен (не короче 16 знаков) и перезапустите: `coregsm restart`.

```
METRICS_TOKEN=замените-на-длинный-случайный-токен
```

Без токена маршрут `/api/metrics` не существует (отвечает 404). Проверка: `curl -H "Authorization: Bearer $TOKEN" https://panel.example.com/api/metrics`.

## 2. Подключить Prometheus

```yaml
scrape_configs:
  - job_name: coregsm
    scheme: https
    metrics_path: /api/metrics
    scrape_interval: 30s
    authorization:
      type: Bearer
      credentials: замените-на-длинный-случайный-токен
    static_configs:
      - targets: ["panel.example.com"]
```

## 3. Панель Grafana

«Dashboards → New → Import» и загрузите [coregsm-grafana.json](coregsm-grafana.json), источник данных: ваш Prometheus. На ней: серверы онлайн, игроки, пинг,
длительность цикла опроса и сбои, очередь бота, размер базы, память, свободный диск.

## 4. Правила оповещений

Положите [prometheus-rules.yml](prometheus-rules.yml) рядом с Prometheus (например, как `coregsm-rules.yml`) и подключите в `rule_files`. В правиле `CoreGSMPollTooSlow`
замените `30000` на ваш интервал опроса в миллисекундах. Что значат пороги и что делать: [../limits.md](../limits.md).

## Какие метрики есть

`coregsm_info`, `coregsm_uptime_seconds`, `coregsm_servers`, `coregsm_servers_online`, `coregsm_players_total`, `coregsm_server_online`, `coregsm_server_players`,
`coregsm_server_max_players`, `coregsm_server_ping_ms`, `coregsm_server_last_poll_timestamp_seconds`, `coregsm_poll_duration_ms`, `coregsm_poll_failures`,
`coregsm_queue_length`, `coregsm_bot_up`, `coregsm_bot_state`, `coregsm_db_bytes`, `coregsm_memory_rss_bytes`, `coregsm_disk_free_bytes`.
Список собирает `src/core-backend/src/monitoring/metrics.ts`; тест следит, чтобы панель и правила не ссылались на несуществующие метрики.
