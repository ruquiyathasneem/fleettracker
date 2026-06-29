import math
from io import BytesIO
from datetime import datetime
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.graphics.shapes import Drawing, Rect, Line, String as DString, Circle, PolyLine
from ..models import Trip, LocationLog

def generate_trip_pdf(trip: Trip, route_points: list, driver_name: str, reg_number: str) -> BytesIO:
    """
    Generates a premium PDF report for a completed trip and returns a BytesIO buffer.
    Includes trip details, stats cards, and a custom-drawn speed-over-time graph.
    """
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=36,
        leftMargin=36,
        topMargin=36,
        bottomMargin=36
    )
    
    styles = getSampleStyleSheet()
    
    # Custom Palette
    PRIMARY = colors.HexColor("#1e293b")   # Slate 800
    SECONDARY = colors.HexColor("#4f46e5") # Indigo 600
    ACCENT = colors.HexColor("#06b6d4")    # Cyan 500
    BG_LIGHT = colors.HexColor("#f8fafc")  # Slate 50
    TEXT_DARK = colors.HexColor("#0f172a") # Slate 900
    TEXT_MUTED = colors.HexColor("#64748b")# Slate 500
    BORDER_COLOR = colors.HexColor("#e2e8f0")
    
    # Custom Paragraph Styles
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=24,
        leading=28,
        textColor=PRIMARY,
        spaceAfter=6
    )
    
    subtitle_style = ParagraphStyle(
        'DocSubtitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=12,
        leading=16,
        textColor=TEXT_MUTED,
        spaceAfter=20
    )
    
    h2_style = ParagraphStyle(
        'SectionHeader',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=14,
        leading=18,
        textColor=SECONDARY,
        spaceBefore=15,
        spaceAfter=10
    )
    
    body_style = ParagraphStyle(
        'BodyTextCustom',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=10,
        leading=14,
        textColor=TEXT_DARK
    )
    
    card_title_style = ParagraphStyle(
        'CardTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=10,
        leading=12,
        textColor=TEXT_MUTED,
        alignment=1 # Center
    )
    
    card_value_style = ParagraphStyle(
        'CardValue',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=16,
        leading=20,
        textColor=SECONDARY,
        alignment=1 # Center
    )

    story = []
    
    # 1. Header Header
    story.append(Paragraph("VEHICLE JOURNEY PERFORMANCE REPORT", title_style))
    story.append(Paragraph(f"Generated on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} | System: GPS Tracker", subtitle_style))
    story.append(Spacer(1, 10))
    
    # 2. Metadata Section (Info Grid)
    # Build start/end location strings: prefer geocoded address, fall back to coordinates
    start_location_str = trip.start_address or (f"{trip.start_lat:.5f}, {trip.start_lng:.5f}" if trip.start_lat else "N/A")
    end_location_str = trip.end_address or (f"{trip.end_lat:.5f}, {trip.end_lng:.5f}" if trip.end_lat else "In Progress")
    
    info_data = [
        [
            Paragraph("<b>Vehicle Reg:</b>", body_style), Paragraph(reg_number, body_style),
            Paragraph("<b>Driver:</b>", body_style), Paragraph(driver_name, body_style)
        ],
        [
            Paragraph("<b>Start Time:</b>", body_style), Paragraph(trip.start_time.strftime('%Y-%m-%d %H:%M:%S') if trip.start_time else "N/A", body_style),
            Paragraph("<b>End Time:</b>", body_style), Paragraph(trip.end_time.strftime('%Y-%m-%d %H:%M:%S') if trip.end_time else "In Progress", body_style)
        ],
        [
            Paragraph("<b>Origin:</b>", body_style), Paragraph(start_location_str, body_style),
            Paragraph("<b>Destination:</b>", body_style), Paragraph(end_location_str, body_style)
        ]
    ]
    
    info_table = Table(info_data, colWidths=[90, 180, 90, 180])
    info_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), BG_LIGHT),
        ('BOX', (0,0), (-1,-1), 1, BORDER_COLOR),
        ('INNERGRID', (0,0), (-1,-1), 0.5, BORDER_COLOR),
        ('TOPPADDING', (0,0), (-1,-1), 8),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ('LEFTPADDING', (0,0), (-1,-1), 10),
        ('RIGHTPADDING', (0,0), (-1,-1), 10),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ]))
    story.append(info_table)
    story.append(Spacer(1, 20))
    
    # 3. Stats Cards Table
    duration_str = "N/A"
    if trip.start_time and trip.end_time:
        duration = trip.end_time - trip.start_time
        hours, remainder = divmod(duration.total_seconds(), 3600)
        minutes, seconds = divmod(remainder, 60)
        duration_str = f"{int(hours)}h {int(minutes)}m"

    stats_data = [
        [
            Paragraph("TOTAL DISTANCE", card_title_style),
            Paragraph("MAX SPEED", card_title_style),
            Paragraph("AVG SPEED", card_title_style),
            Paragraph("TRIP DURATION", card_title_style)
        ],
        [
            Paragraph(f"{trip.distance_km:.2f} km", card_value_style),
            Paragraph(f"{trip.max_speed_kmph:.1f} km/h", card_value_style),
            Paragraph(f"{trip.avg_speed_kmph:.1f} km/h", card_value_style),
            Paragraph(duration_str, card_value_style)
        ]
    ]
    
    stats_table = Table(stats_data, colWidths=[135, 135, 135, 135])
    stats_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor("#e0e7ff")), # Indigo light
        ('BOX', (0,0), (-1,-1), 1, SECONDARY),
        ('TOPPADDING', (0,0), (-1,0), 10),
        ('BOTTOMPADDING', (0,0), (-1,0), 2),
        ('TOPPADDING', (0,1), (-1,1), 2),
        ('BOTTOMPADDING', (0,1), (-1,1), 10),
        ('ALIGN', (0,0), (-1,-1), 'CENTER'),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ]))
    story.append(stats_table)
    story.append(Spacer(1, 20))
    
    # 4. Speed Over Time Graph Section
    story.append(Paragraph("Speed Profile (Speed-Over-Time Graph)", h2_style))
    
    # Build Custom Drawing Graph
    graph_width = 540
    graph_height = 160
    d = Drawing(graph_width, graph_height)
    
    # Draw Background
    d.add(Rect(0, 0, graph_width, graph_height, fillColor=BG_LIGHT, strokeColor=BORDER_COLOR))
    
    # Extract speeds and times
    speeds = [p.speed_kmph if p.speed_kmph is not None else 0.0 for p in route_points]
    
    if len(speeds) > 1:
        max_speed_val = max(speeds) if max(speeds) > 0 else 50.0
        # Round max speed axis up
        y_max = math.ceil(max_speed_val / 10.0) * 10
        if y_max < 20:
            y_max = 20
            
        x_margin_left = 50
        x_margin_right = 20
        y_margin_bottom = 30
        y_margin_top = 15
        
        plot_width = graph_width - x_margin_left - x_margin_right
        plot_height = graph_height - y_margin_bottom - y_margin_top
        
        # Draw Y-Axis Grid Lines & Labels
        for i in range(5):
            y_val = (y_max / 4) * i
            y_pos = y_margin_bottom + (plot_height / 4) * i
            d.add(Line(x_margin_left, y_pos, graph_width - x_margin_right, y_pos, strokeColor=BORDER_COLOR, strokeWidth=0.5))
            d.add(DString(15, y_pos - 4, f"{y_val:.0f} km/h", fontName='Helvetica', fontSize=8, fillColor=TEXT_MUTED))
            
        # Draw X-Axis Ticks & Labels (Time)
        total_points = len(route_points)
        x_intervals = 5 if total_points >= 5 else total_points
        
        for i in range(x_intervals):
            idx = int((total_points - 1) / (x_intervals - 1) * i)
            pt = route_points[idx]
            x_pos = x_margin_left + (plot_width / (x_intervals - 1)) * i
            
            # Label
            time_str = pt.recorded_at.strftime('%H:%M:%S')
            d.add(Line(x_pos, y_margin_bottom, x_pos, y_margin_bottom - 5, strokeColor=TEXT_MUTED, strokeWidth=1))
            d.add(DString(x_pos - 20, y_margin_bottom - 15, time_str, fontName='Helvetica', fontSize=8, fillColor=TEXT_MUTED))
            
        # Plot Speed Line
        points_list = []
        for idx, pt in enumerate(route_points):
            x_pos = x_margin_left + (plot_width / (total_points - 1)) * idx
            y_pos = y_margin_bottom + (plot_height * (pt.speed_kmph if pt.speed_kmph is not None else 0.0) / y_max)
            points_list.append((x_pos, y_pos))
            
        # Flat list of coords for PolyLine
        flat_points = [coord for pt in points_list for coord in pt]
        d.add(PolyLine(flat_points, strokeColor=SECONDARY, strokeWidth=2))
        
        # Add blue dots on points if <= 30 points to look premium
        if total_points <= 35:
            for pt_x, pt_y in points_list:
                d.add(Circle(pt_x, pt_y, 2, fillColor=ACCENT, strokeColor=SECONDARY, strokeWidth=0.5))
    else:
        # Not enough data message
        d.add(DString(graph_width / 2 - 100, graph_height / 2, "Insufficient speed logs to display graph", fontName='Helvetica-Bold', fontSize=10, fillColor=TEXT_MUTED))
        
    story.append(d)
    story.append(Spacer(1, 20))
    
    # 5. Route Log Table (Sampled points)
    story.append(Paragraph("Journey Location Details (Sampled Logs)", h2_style))
    
    table_header = [
        Paragraph("<b>Time</b>", body_style),
        Paragraph("<b>Latitude</b>", body_style),
        Paragraph("<b>Longitude</b>", body_style),
        Paragraph("<b>Speed</b>", body_style),
        Paragraph("<b>Heading</b>", body_style)
    ]
    
    log_rows = [table_header]
    
    # Sample down logs to fit on page (at most 15 points)
    sampled_points = []
    if len(route_points) <= 15:
        sampled_points = route_points
    else:
        step = len(route_points) // 15
        sampled_points = [route_points[i] for i in range(0, len(route_points), step)][:15]
        # Always include the last log point
        if route_points[-1] not in sampled_points:
            sampled_points[-1] = route_points[-1]
            
    for pt in sampled_points:
        log_rows.append([
            Paragraph(pt.recorded_at.strftime('%Y-%m-%d %H:%M:%S'), body_style),
            Paragraph(f"{pt.latitude:.5f}", body_style),
            Paragraph(f"{pt.longitude:.5f}", body_style),
            Paragraph(f"{pt.speed_kmph:.1f} km/h" if pt.speed_kmph is not None else "0.0 km/h", body_style),
            Paragraph(f"{pt.heading:.0f}°" if pt.heading is not None else "0°", body_style),
        ])
        
    log_table = Table(log_rows, colWidths=[140, 100, 100, 100, 100])
    log_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), BORDER_COLOR),
        ('BOX', (0,0), (-1,-1), 1, BORDER_COLOR),
        ('INNERGRID', (0,0), (-1,-1), 0.5, BORDER_COLOR),
        ('TOPPADDING', (0,0), (-1,-1), 5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 5),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, BG_LIGHT])
    ]))
    story.append(log_table)
    
    # Build Document
    doc.build(story)
    buffer.seek(0)
    return buffer
