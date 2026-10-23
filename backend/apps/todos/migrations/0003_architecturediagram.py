# Generated manually for per-workspace architecture diagram.

import apps.todos.models
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("todos", "0002_document"),
    ]

    operations = [
        migrations.CreateModel(
            name="ArchitectureDiagram",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("title", models.CharField(blank=True, default="", max_length=200)),
                ("mermaid", models.TextField(blank=True, default="")),
                (
                    "image",
                    models.FileField(
                        blank=True,
                        max_length=512,
                        null=True,
                        upload_to=apps.todos.models.architecture_image_upload_to,
                    ),
                ),
                (
                    "preferred",
                    models.CharField(
                        choices=[("mermaid", "Mermaid"), ("image", "Image")],
                        default="mermaid",
                        max_length=16,
                    ),
                ),
                (
                    "workspace",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="architecture",
                        to="todos.workspace",
                    ),
                ),
            ],
            options={
                "ordering": ("-updated_at",),
            },
        ),
    ]
