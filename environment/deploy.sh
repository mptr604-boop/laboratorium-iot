#!/bin/bash
# environment/deploy.sh
# Produkcyjny skrypt wdrożeniowy oparty na strukturze katalogów wydań i symlinkach

# Włączamy tryb natychmiastowego przerywania przy błędzie
set -e

# Definiujemy ścieżki główne na hoście produkcyjnym
PROJEKT_DIR="$(cd "$(dirname "${BASH_SOURCE}")/.." && pwd)"
STRUKTURA_DIR="$PROJEKT_DIR/deploy_root"
RELEASES_DIR="$STRUKTURA_DIR/releases"
CURRENT_LINK="$STRUKTURA_DIR/current"
STORAGE_DIR="$STRUKTURA_DIR/storage"

# Przyjmujemy parametry wejściowe skryptu
AKCJA=$1       # 'staging', 'production' lub 'rollback'
WERSJA_TAG=$2  # Numer wersji (np. v1, v2, v3)

# Funkcja inicjalizująca strukturę katalogów na serwerze przy pierwszym uruchomieniu
inicjalizuj_strukture() {
    sudo mkdir -p "$RELEASES_DIR"
    sudo mkdir -p "$STORAGE_DIR/notatki_pdf"
}

# Funkcja uruchamiająca kontenery Docker w oparciu o wskazany katalog wydania
odpal_kontenery() {
    local target_dir=$1
    local env_mode=$2
    echo "[DEPLOY] Uruchamiam Docker Compose wewnątrz katalogu: $target_dir..."
    
    cd "$target_dir"
    export APP_VERSION_TAG=$WERSJA_TAG
    export NODE_ENV=$env_mode
    
    # Wymuszamy uruchomienie przez sudo wewnątrz skryptu
    sudo docker compose -f environment/docker-compose.yml up -d --build
}


# Inicjalizujemy bazową strukturę folderów wydań
inicjalizuj_strukture()

case "$AKCJA" in
    staging)
        # Staging wdraża się do jednego, stałego katalogu dedykowanego do testów
        local staging_path="$STRUKTURA_DIR/staging_release"
        echo "[DEPLOY] Przygotowuję czysty kod dla środowiska STAGING..."
        
        # Tworzymy i czyścimy katalog stagingu
        sudo mkdir -p "$staging_path"
        sudo rsync -a --exclude='mini_debian_dev' --exclude='deploy_root' "$PROJEKT_DIR/" "$staging_path/"
        
        # Odpalamy kontenery testowe na porcie 8080
        WERSJA_TAG="staging-latest"
        odpal_kontenery "$staging_path" "staging"
        echo "[INFO] Środowisko Staging działa bezbłędnie pod adresem: http://localhost:8080"
        ;;
        
    production)
        # Produkcja wymaga podania sztywnego katalogu wersji (np. v1, v2, v3)
        if [ -z "$WERSJA_TAG" ]; then
            echo "[BŁĄD] Podaj wersję wydania! Przykład: ./deploy.sh production v1"
            exit 1
        fi
        
        local nowa_wersja_path="$RELEASES_DIR/$WERSJA_TAG"
        
        if [ -d "$nowa_wersja_path" ]; then
            echo "[BŁĄD] Katalog wydania $WERSJA_TAG już istnieje! Użyj nowego numeru (np. v2)."
            exit 1
        fi
        
        echo "[DEPLOY] Tworzę fizyczny, odizolowany katalog wydania: $nowa_wersja_path"
        sudo mkdir -p "$nowa_wersja_path"
        
        # Kopiujemy kod projektu do nowego folderu wersji, całkowicie pomijając chroota i inne wydania
        sudo rsync -a --exclude='mini_debian_dev' --exclude='deploy_root' "$PROJEKT_DIR/" "$nowa_wersja_path/"
        
        # Odpalamy nową wersję w jej własnym katalogu
        odpal_kontenery "$nowa_wersja_path" "production"
        
        # PRZEPINANIE SYMLINKA (Najważniejszy krok Zero-Downtime)
        echo "[DEPLOY] Przepinam skrót systemowy 'current' na nowe wydanie $WERSJA_TAG..."
        sudo rm -f "$CURRENT_LINK"
        sudo ln -s "$nowa_wersja_path" "$CURRENT_LINK"
        
        echo "[INFO] Produkcja została pomyślnie zaktualizowana pod adresem: http://localhost:80"
        ;;
        
    rollback)
        # Zapytanie o wersję, do której chcemy bezpiecznie cofnąć skrót systemowy
        if [ -z "$WERSJA_TAG" ]; then
            echo "[BŁĄD] Podaj katalog wersji do przywrócenia! Przykład: ./deploy.sh rollback v1"
            exit 1
        fi
        
        local wersja_docelowa_path="$RELEASES_DIR/$WERSJA_TAG"
        
        # Weryfikujemy czy fizyczny katalog starej wersji na pewno leży na dysku serwera
        if [ ! -d "$wersja_docelowa_path" ]; then
            echo "[BŁĄD] Nie znaleziono katalogu wersji: $wersja_docelowa_path! Nie mam do czego wrócić."
            exit 1
        fi
        
        echo "[ROLLBACK] ⚠️⚠️ URUCHAMIAM PROCEDURĘ NATYCHMIASTOWEGO WYCOFANIA DO: $WERSJA_TAG ⚠️⚠️"
        
        # KROK 1: Przepinamy symlink wstecz do starego folderu w ułamku milisekundy
        sudo rm -f "$CURRENT_LINK"
        sudo ln -s "$wersja_docelowa_path" "$CURRENT_LINK"
        
        # KROK 2: Wchodzimy do tamtego starego katalogu i podnosimy tamte kontenery
        odpal_kontenery "$wersja_docelowa_path" "production"
        
        echo "[ROLLBACK] Sukces! Skrót systemowy został cofnięty. Produkcja działa na stabilnej wersji $WERSJA_TAG."
        ;;
        
    *)
        echo "Użycie: $0 {staging|production|rollback} [wersja_tag]"
        exit 1
        ;;
esac

