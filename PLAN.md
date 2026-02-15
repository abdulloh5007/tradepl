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



1. Теперь нужно спреды исправить на каждом счете спреды теперь они тоже будут плывать то есть меняться когда время новосте или когда идут большие импульсы но не так много не изменятся или это тоже будет считано системой смотря на импульсы ? Есть идеи ? 


2. У меня вопрос если бота сделать админом на группе где есть запросы на ввод средств то если на панеле я разрешу админу проверять запросы на ввод то бот здесь должен чуть аккуратно сработать когда я разрешу админу на просмотр и проверку запросы на ввод бот должен оповести админа (через бота если админ не удалил чат и заблокировал бота) или на команду /help админа добавить новую команду который выдаст ссылку на вступления на чат где проверяются запросы и если админ вступит по ссылке то чат же закрытый и будет прийти запрос на вступления и бот автоматически примит его если он есть в админе и есть права на проверку ввода а если даже нет в админах то автоматически будет отклонять запросы на встпуления чат ! Можно ли так ? или есть твои идеи или вопросы ? 