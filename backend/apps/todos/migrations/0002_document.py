# Generated manually for Workspace Document support.

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("todos", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Document",
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
                ("title", models.CharField(max_length=200)),
                ("body", models.TextField(blank=True, default="")),
                (
                    "kind",
                    models.CharField(
                        choices=[
                            ("plan", "Plan"),
                            ("note", "Note"),
                            ("decision", "Decision"),
                            ("spec", "Spec"),
                        ],
                        default="plan",
                        max_length=16,
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("draft", "Draft"),
                            ("active", "Active"),
                            ("archived", "Archived"),
                        ],
                        default="active",
                        max_length=16,
                    ),
                ),
                ("path", models.CharField(blank=True, default="", max_length=512)),
                ("sort_order", models.IntegerField(default=0)),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="created_documents",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "tags",
                    models.ManyToManyField(
                        blank=True, related_name="documents", to="todos.tag"
                    ),
                ),
                (
                    "workspace",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="documents",
                        to="todos.workspace",
                    ),
                ),
            ],
            options={
                "ordering": ("sort_order", "-updated_at"),
            },
        ),
        migrations.AddIndex(
            model_name="document",
            index=models.Index(
                fields=["workspace", "status"], name="todos_docum_workspa_7f0a1c_idx"
            ),
        ),
        migrations.AddIndex(
            model_name="document",
            index=models.Index(
                fields=["workspace", "kind"], name="todos_docum_workspa_3b9e2d_idx"
            ),
        ),
    ]
