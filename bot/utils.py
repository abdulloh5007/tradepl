import re
from typing import Tuple

def parse_duration(duration_str: str) -> Tuple[int, str]:
    """
    Parse duration string to seconds.
    
    Examples:
        "600" -> 600 seconds
        "60m" -> 60 minutes = 3600 seconds
        "24h" -> 24 hours = 86400 seconds
    
    Returns tuple of (seconds, human_readable_string)
    """
    if not duration_str:
        # Default: 1 hour
        return 3600, "1 hour"
    
    duration_str = duration_str.strip().lower()
    
    # Check for hours
    match = re.match(r'^(\d+)h$', duration_str)
    if match:
        hours = int(match.group(1))
        return hours * 3600, f"{hours} hour{'s' if hours > 1 else ''}"
    
    # Check for minutes
    match = re.match(r'^(\d+)m$', duration_str)
    if match:
        minutes = int(match.group(1))
        return minutes * 60, f"{minutes} minute{'s' if minutes > 1 else ''}"
    
    # Plain number (seconds)
    match = re.match(r'^(\d+)$', duration_str)
    if match:
        seconds = int(match.group(1))
        if seconds >= 3600:
            hours = seconds // 3600
            return seconds, f"{hours} hour{'s' if hours > 1 else ''}"
        elif seconds >= 60:
            minutes = seconds // 60
            return seconds, f"{minutes} minute{'s' if minutes > 1 else ''}"
        else:
            return seconds, f"{seconds} second{'s' if seconds > 1 else ''}"
    
    # Invalid format, default to 1 hour
    return 3600, "1 hour"


def format_rights(rights: dict) -> str:
    """Format rights dict to readable string."""
    if not rights:
        return "No rights"
    
    names = {
        "sessions": "📊 Sessions",
        "trend": "📈 Trend",
        "events": "🎯 Events",
        "volatility": "📉 Volatility",
        "kyc_review": "🛂 KYC Review",
        "deposit_review": "💳 Deposit Review",
    }
    
    active = [names.get(k, k) for k, v in rights.items() if v]
    return ", ".join(active) if active else "No rights"
