#!/bin/bash
# kanban-task-monitor.sh - Robust kanban task monitoring with auto-restart
# 
# This script ensures the auto-task-processor is always running
# and provides status reporting

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MC_DIR="$HOME/.openclaw/workspace/personal/mission-control-v2"
PROCESSOR_SCRIPT="$HOME/.openclaw/workspace/.mission-control/auto-task-processor.sh"
PIDFILE="/tmp/kanban-monitor.pid"
LOG_FILE="/tmp/kanban-monitor.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Check if processor is running
is_processor_running() {
  pgrep -f "auto-task-processor.sh" > /dev/null 2>&1
}

# Get processor PID
get_processor_pid() {
  pgrep -f "auto-task-processor.sh" | head -1
}

# Start the processor
start_processor() {
  log "Starting auto-task-processor..."
  
  # Ensure MC server is running
  if ! curl -sf "http://localhost:3000/api/tasks" &>/dev/null; then
    log "⚠️  Mission Control not running on port 3000"
    log "Please start it: cd $MC_DIR && npm start"
    return 1
  fi
  
  # Start processor in background
  nohup bash "$PROCESSOR_SCRIPT" >> "$LOG_FILE" 2>&1 &
  sleep 2
  
  if is_processor_running; then
    local pid=$(get_processor_pid)
    log "✓ Processor started (PID: $pid)"
    return 0
  else
    log "✗ Failed to start processor"
    return 1
  fi
}

# Stop the processor
stop_processor() {
  log "Stopping auto-task-processor..."
  pkill -f "auto-task-processor.sh" 2>/dev/null || true
  sleep 1
  
  if is_processor_running; then
    # Force kill
    pkill -9 -f "auto-task-processor.sh" 2>/dev/null || true
  fi
  
  if ! is_processor_running; then
    log "✓ Processor stopped"
  else
    log "⚠️  Could not stop processor"
  fi
}

# Status check
show_status() {
  echo "╔════════════════════════════════════════════════════════════╗"
  echo "║           KANBAN TASK MONITOR STATUS                      ║"
  echo "╚════════════════════════════════════════════════════════════╝"
  echo ""
  
  # Check Mission Control
  if curl -sf "http://localhost:3000/api/health" &>/dev/null; then
    echo "✅ Mission Control: Running (port 3000)"
    local task_count=$(curl -sf "http://localhost:3000/api/tasks" 2>/dev/null | jq '[.tasks[] | select(.status == "in_progress")] | length' || echo 0)
    echo "   Tasks In Progress: $task_count"
  else
    echo "❌ Mission Control: NOT RUNNING"
    echo "   Start with: cd $MC_DIR && npm start"
  fi
  
  echo ""
  
  # Check processor
  if is_processor_running; then
    local pid=$(get_processor_pid)
    echo "✅ Auto-Task-Processor: Running (PID: $pid)"
    
    # Show last log lines
    echo ""
    echo "Last 5 log entries:"
    tail -5 "$MC_DIR/../.mission-control/processor.log" 2>/dev/null | sed 's/^/   /' || echo "   (no log)"
  else
    echo "❌ Auto-Task-Processor: NOT RUNNING"
    echo "   Start with: $0 start"
  fi
  
  echo ""
  
  # Show recent backups
  echo "Recent Backups:"
  ls -1t "$MC_DIR/../backups/" 2>/dev/null | head -3 | sed 's/^/   /' || echo "   (none)"
  
  echo ""
}

# Watchdog loop - keeps processor running
daemon_mode() {
  log "Starting kanban monitor daemon..."
  echo $$ > "$PIDFILE"
  
  while true; do
    if ! is_processor_running; then
      log "⚠️  Processor not running, restarting..."
      start_processor || sleep 5
    fi
    
    # Check every 10 seconds
    sleep 10
  done
}

# Main command handler
case "${1:-status}" in
  start|s)
    if is_processor_running; then
      echo "Processor already running (PID: $(get_processor_pid))"
      exit 0
    fi
    
    echo "Starting kanban task monitor..."
    start_processor
    
    # Start daemon mode in background
    nohup bash "$0" daemon >> "$LOG_FILE" 2>&1 &
    sleep 1
    
    echo "✓ Monitor started"
    echo "Logs: tail -f $LOG_FILE"
    ;;
    
  stop|kill)
    echo "Stopping kanban task monitor..."
    
    # Stop daemon
    if [ -f "$PIDFILE" ]; then
      kill $(cat "$PIDFILE") 2>/dev/null || true
      rm -f "$PIDFILE"
    fi
    
    # Stop processor
    stop_processor
    
    echo "✓ Stopped"
    ;;
    
  restart|r)
    $0 stop
    sleep 1
    $0 start
    ;;
    
  status|st)
    show_status
    ;;
    
  daemon|d)
    # Internal: run watchdog loop
    daemon_mode
    ;;
    
  logs|l)
    echo "=== Kanban Monitor Logs ==="
    tail -50 "$LOG_FILE" 2>/dev/null || echo "No logs yet"
    ;;
    
  processor-logs|pl)
    echo "=== Auto-Task-Processor Logs ==="
    tail -50 "$MC_DIR/../.mission-control/processor.log" 2>/dev/null || echo "No logs yet"
    ;;
    
  *)
    echo "Kanban Task Monitor - Ensures auto-task-processor stays running"
    echo ""
    echo "Usage: $0 <command>"
    echo ""
    echo "Commands:"
    echo "  start       - Start the monitor and processor"
    echo "  stop        - Stop the monitor and processor"
    echo "  restart     - Restart everything"
    echo "  status      - Show current status (default)"
    echo "  logs        - Show monitor logs"
    echo "  processor-logs - Show task processor logs"
    echo ""
    echo "The monitor will auto-restart the processor if it crashes."
    echo ""
    exit 1
    ;;
esac
