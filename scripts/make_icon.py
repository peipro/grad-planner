from PIL import Image, ImageDraw, ImageFont

S = 512
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 圆角方块背景
bg = (79, 110, 247, 255)
d.rounded_rectangle([40, 40, S - 40, S - 40], radius=110, fill=bg)

# 简化"研"字：用方块+横线抽象为书本/日历图形
# 顶部两条横线（日历风格）
d.rounded_rectangle([150, 130, 362, 176], radius=22, fill=(255, 255, 255, 255))
d.rounded_rectangle([150, 210, 362, 256], radius=22, fill=(255, 255, 255, 255))
d.rounded_rectangle([150, 290, 270, 336], radius=22, fill=(255, 255, 255, 255))

# 右下角小方块（装饰）
d.rounded_rectangle([300, 310, 360, 370], radius=14, fill=(255, 255, 255, 180))

img.save('electron/icon.png')

# 生成多尺寸 ico
img_ico = Image.open('electron/icon.png').convert('RGBA')
sizes = [(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)]
img_ico.save('electron/icon.ico', sizes=sizes)
print('icon generated')
