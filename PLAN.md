
2. DB_DSN="postgres://postgres:postgres@localhost:5432/lvtrade?sslmode=disable" ./scripts/seed.sh
psql: error: connection to server at "localhost" (::1), port 5432 failed: FATAL:  password authentication failed for user "postgres"
make: *** [Makefile:35: seed] Error 2


3. Если хочешь, следующим сообщением дам такой же пошаговый блок для автообновления (git pull + rebuild + restart) одной командой.