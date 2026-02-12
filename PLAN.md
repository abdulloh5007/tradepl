{
  "version": "1.0",
  "title": "Trading Candles Storage and Aggregation Spec",
  "goal": "Replace multi-timeframe file storage with single-source-of-truth based on 1-minute candles",
  "language": "go-backend",

  "principles": {
    "single_source_of_truth": true,
    "store_only_base_timeframe": "1m",
    "derived_timeframes_must_not_be_persisted": true,
    "all_higher_timeframes_are_computed": "on_the_fly_from_1m"
  },

  "storage": {
    "type": "filesystem",
    "format": "ndjson",
    "timeframe": "1m",
    "file_pattern": "candles_1m/YYYY/MM/DD.ndjson",
    "append_only": true,
    "rotation": "daily",
    "schema": {
      "t": {
        "type": "int64",
        "description": "unix timestamp in seconds, rounded to minute",
        "constraints": ["multiple_of_60"]
      },
      "o": { "type": "float64" },
      "h": { "type": "float64" },
      "l": { "type": "float64" },
      "c": { "type": "float64" },
      "v": { "type": "float64" }
    }
  },

  "validation": {
    "reject_if": [
      "timestamp_not_aligned_to_minute",
      "high_less_than_low",
      "open_outside_high_low",
      "close_outside_high_low"
    ]
  },

  "forbidden_actions": {
    "write_non_1m_candles": "panic",
    "create_files_for_other_timeframes": "panic",
    "rewrite_existing_1m_records": "panic"
  },

  "aggregation": {
    "source_timeframe": "1m",
    "supported_timeframes": {
      "5m": 300,
      "10m": 600,
      "15m": 900,
      "30m": 1800,
      "1h": 3600
    },
    "alignment": "epoch",
    "window_calculation": {
      "start": "floor(timestamp / timeframe_seconds) * timeframe_seconds",
      "end": "start + timeframe_seconds"
    },
    "rules": {
      "open": "open of first candle in window",
      "high": "max(high of all candles)",
      "low": "min(low of all candles)",
      "close": "close of last candle in window",
      "volume": "sum(volume)"
    }
  },

  "runtime_flow": {
    "on_new_1m_candle": [
      "validate_candle",
      "append_to_1m_storage",
      "invalidate_cache_for_symbol"
    ],
    "on_timeframe_request": [
      "determine_window_range",
      "load_1m_candles_from_storage",
      "aggregate_in_memory",
      "return_result"
    ]
  },

  "cache": {
    "enabled": true,
    "key": "symbol+timeframe+window_start",
    "ttl_seconds": 60,
    "invalidate_on_new_1m": true
  },

  "error_handling": {
    "missing_1m_data": "return_partial_result_with_warning_flag",
    "out_of_order_timestamps": "reject_and_log",
    "aggregation_window_empty": "return_empty_array"
  },

  "performance_limits": {
    "max_1m_candles_per_aggregation": 10000,
    "preferred_batch_size": 5000
  },

  "implementation_notes_for_agent": {
    "do_not_store_any_derived_timeframes": true,
    "all_timeframes_must_be_reproducible_from_1m": true,
    "this_spec_is_authoritative": true,
    "do_not_invent_new_logic": true
  },

  "final_summary": {
    "store": "ONLY 1-minute candles",
    "compute": "ALL higher timeframes from 1m",
    "never": ["store 5m", "store 10m", "store 1h"],
    "reason": "data integrity, disk efficiency, long-term scalability"
  }
}

потом задание если плечо поставлен на unlimited то проверь все ли работает нормально и сделай чтобы на странице истории если плечо unlimited то там free margin и margin спрятать 




6. Нужно придумать новые увлекательные возможности ! Моя первая идея чтобы заманивать больше людей ! сразу после регистрации любой может получить бонус в размере 10$ на свой реальный счет получения бонуса будет карточка над карточкой аккаунта на странице счетов карточка будет прямоугольной то есть высота будет чуть меньше и внутри будет кнопка получения бонуса и карточка будет такой красивой заманчивой при нажатии на получить откроется окно там где пользователь должен согласиться с условиями проекта. Нужно написать что при получении бонуса тп чп короче и внизу кнопка с чекбоксом при соглашении кнопка загориться и пользователь получит бонус на свой реальный счет и может торговаться им. В историях это будет фиксировано как bxrew....

7. Новая логика реферальная система так как мы используем тг авторизацию сделать реф будет намного легче короче логика такая если пользователь поделиться со своим реферальной системой то откроется окно поделиться у тг (то есть свой собственный у тг) а ссылка будет сразу открывать мини апп и засчитать реферала сразу после входа реферала пользователь вызвавший получит 5$ на свой реферальный счет из него можно только вывести когда будет 30$ и только на реальный счет и еще + сторона будет если пользователь введет реальные средства только реальные ! то пользователь позвавшим получит от него комиссии 10% и он тоже будет накапливаться на реферальный счет ! Если пользователь снимит с реферального баланса то в историях это будет фиксировано как bxref....

8. Еще один тип бонуса которым подтвердили свою личность да да будет логика подтверждения личности это логика будет чуть сложнее потому работа будет через бота тоже если пользователь подтвердит свою личность то он получит бонус в размере 50$ на свой реальный счет как будет работать функция пользователь после отправки данных например пасспорт или удостоверения личности или права и с ними место жительства то данные будут отправлены через тг в чат который будет закрытым и в нем будет только бот и проверщик бот отправит сообщение с картинкой и все данными пользователя и внизу будут кнопки подтвердить и отклонить цветные (который тг недавно выпустил обнову с цветными кнопками на тг). Пользователь получит оповещение который данные будут проверены в течении 8 часов и если статус одобрен то пользователь получит а если статус отклонен то пользователь получит спам то есть блок который блокирует отправить документы еще раз в течении 24 часа после второй не удачной попытки пользователь получит новое оповещение который если еще раз отправит неправильные документы то получит бан на неделю и даже с этого не остановиться то в следущий раз получит бан на навсегда. Нужно быть аккуратным так как здесь очень много логики новые страницы с показом счетчика до истечения бана и т.д. Если есть вопросы то задавай !